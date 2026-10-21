use std::collections::HashMap;
use std::error::Error;
use std::net::IpAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::header::CONTENT_TYPE;
use reqwest::{StatusCode, Url};
use serde::Serialize;
use serde_json::Value;
use tauri::async_runtime;
use tauri::ipc::Channel;
use tauri::State;
use tokio::sync::oneshot;

/// Keychain / Credential Manager / Secret Service entries live under this
/// service, one per provider origin.
const KEYRING_SERVICE: &str = "app.pilecommander.ai";

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const MODELS_TIMEOUT: Duration = Duration::from_secs(20);
/// A local model can spend minutes loading into memory before its first
/// token, so the wait for the response and between chunks is generous.
const STALL_TIMEOUT: Duration = Duration::from_secs(180);
/// How much of a provider's error body reaches the UI.
const DETAIL_LIMIT: usize = 600;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum AiErrorKind {
    InvalidUrl,
    InvalidInput,
    Connect,
    Timeout,
    Network,
    Unauthorized,
    NotFound,
    RateLimited,
    BadRequest,
    Http,
    Provider,
    Keyring,
}

/// What the client gets on failure. `message` is the provider's own text
/// where there is one (it tells "model does not support images" apart from
/// other bad requests); it never carries the API key.
#[derive(Debug, Clone, Serialize)]
pub struct AiError {
    kind: AiErrorKind,
    status: Option<u16>,
    message: String,
}

impl AiError {
    fn new(kind: AiErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            status: None,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "event", content = "data", rename_all = "snake_case")]
pub enum AiEvent {
    Delta { text: String },
    Done,
    Error(AiError),
}

fn error_chain(err: &dyn Error) -> String {
    let mut message = err.to_string();
    let mut source = err.source();
    while let Some(inner) = source {
        message.push_str(": ");
        message.push_str(&inner.to_string());
        source = inner.source();
    }
    message
}

fn request_error(error: reqwest::Error) -> AiError {
    let kind = if error.is_connect() {
        AiErrorKind::Connect
    } else if error.is_timeout() {
        AiErrorKind::Timeout
    } else {
        AiErrorKind::Network
    };
    AiError::new(kind, error_chain(&error.without_url()))
}

fn stalled() -> AiError {
    AiError::new(AiErrorKind::Timeout, "the provider stopped responding")
}

fn keyring_error(error: keyring::Error) -> AiError {
    AiError::new(AiErrorKind::Keyring, error_chain(&error))
}

/// How far a request to a host travels, judged from the address alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Reach {
    Loopback,
    PrivateNetwork,
    /// a public address, or a name whose address cannot be told from the text
    Unknown,
}

fn ip_reach(ip: IpAddr) -> Reach {
    let ip = match ip {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map(IpAddr::V4).unwrap_or(ip),
        v4 => v4,
    };
    if ip.is_loopback() {
        return Reach::Loopback;
    }
    let private = match ip {
        IpAddr::V4(v4) => {
            let [a, b, ..] = v4.octets();
            a == 10
                || (a == 172 && (16..=31).contains(&b))
                || (a == 192 && b == 168)
                || (a == 169 && b == 254)
                // 100.64.0.0/10: carrier-grade NAT, where Tailscale lives
                || (a == 100 && (64..=127).contains(&b))
        }
        IpAddr::V6(v6) => {
            let first = v6.segments()[0];
            // fc00::/7 unique local, fe80::/10 link-local
            first & 0xfe00 == 0xfc00 || first & 0xffc0 == 0xfe80
        }
    };
    if private {
        Reach::PrivateNetwork
    } else {
        Reach::Unknown
    }
}

/// A bare name (`homeserver`) or a MagicDNS one could resolve anywhere, so
/// only IP literals and mDNS `.local` names count as the local network.
fn reach(url: &Url) -> Reach {
    let Some(host) = url.host_str() else {
        return Reach::Unknown;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<IpAddr>() {
        return ip_reach(ip);
    }
    if host.eq_ignore_ascii_case("localhost") {
        Reach::Loopback
    } else if host.len() > ".local".len() && host.to_ascii_lowercase().ends_with(".local") {
        Reach::PrivateNetwork
    } else {
        Reach::Unknown
    }
}

/// The provider's base URL (`…/v1`). Plain http stays on this machine or the
/// local network; anything else goes over https.
fn parse_base_url(raw: &str) -> Result<Url, AiError> {
    let invalid = |message: &str| AiError::new(AiErrorKind::InvalidUrl, message);
    let url = Url::parse(raw.trim()).map_err(|error| invalid(&error.to_string()))?;
    match url.scheme() {
        "https" => {}
        "http" if reach(&url) != Reach::Unknown => {}
        "http"
            if url
                .host_str()
                .is_some_and(|host| host.parse::<IpAddr>().is_err()) =>
        {
            return Err(invalid(
                "plain http works only on this computer or your local network: \
                 use the server's IP address, a .local name, or https",
            ))
        }
        "http" => {
            return Err(invalid(
                "plain http works only on this computer or your local network; use https",
            ))
        }
        _ => return Err(invalid("the address must start with https://")),
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err(invalid("the address must not contain credentials"));
    }
    if url.query().is_some() || url.fragment().is_some() {
        return Err(invalid("the address must not contain ? or #"));
    }
    Ok(url)
}

fn endpoint(base: &Url, path: &str) -> Url {
    let mut url = base.clone();
    let joined = format!("{}/{}", base.path().trim_end_matches('/'), path);
    url.set_path(&joined);
    url
}

/// The keyring account a key is stored under. Requests read the key by the
/// origin they are sent to, so a key saved for one provider is never
/// attached to another host, whatever base URL the webview passes.
fn origin_of(url: &Url) -> String {
    url.origin().ascii_serialization()
}

fn keyring_entry(origin: &str) -> Result<keyring::Entry, AiError> {
    keyring::Entry::new(KEYRING_SERVICE, origin).map_err(keyring_error)
}

/// Keychain calls block (and may show a system prompt), so they stay off
/// the async runtime's workers and the main thread.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, AiError> + Send + 'static,
) -> Result<T, AiError> {
    async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| AiError::new(AiErrorKind::Keyring, error.to_string()))?
}

/// Where a key for `base` may be stored and sent: over https, or to this
/// machine. Plain http across the local network never carries one.
fn key_origin(base: &Url) -> Option<String> {
    (base.scheme() == "https" || reach(base) == Reach::Loopback).then(|| origin_of(base))
}

fn read_stored_key(origin: &str) -> Result<Option<String>, AiError> {
    match keyring_entry(origin)?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(keyring_error(error)),
    }
}

fn key_for_with(
    base: &Url,
    read: impl FnOnce(&str) -> Result<Option<String>, AiError>,
) -> Result<Option<String>, AiError> {
    match key_origin(base) {
        Some(origin) => read(&origin),
        None => Ok(None),
    }
}

/// The key a request to `base` carries, if any. Every request gets its key
/// here and nowhere else.
async fn key_for(base: &Url) -> Result<Option<String>, AiError> {
    let base = base.clone();
    blocking(move || key_for_with(&base, read_stored_key)).await
}

/// The key is replaced before the cut: a key straddling `DETAIL_LIMIT` would
/// otherwise leave its head in the message.
fn scrub(text: &str, key: Option<&str>) -> String {
    let text = match key {
        Some(key) if !key.is_empty() => text.replace(key, "***"),
        _ => text.to_owned(),
    };
    text.trim().chars().take(DETAIL_LIMIT).collect()
}

fn error_text(error: &Value) -> String {
    match error {
        Value::String(text) => text.clone(),
        Value::Object(fields) => fields
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| error.to_string()),
        other => other.to_string(),
    }
}

/// `{"error": {"message": …}}` (OpenAI, OpenRouter, LM Studio),
/// `{"error": "…"}` (Ollama) or the raw body.
fn provider_message(body: &str) -> String {
    match serde_json::from_str::<Value>(body) {
        Ok(value) => match value.get("error").or_else(|| value.get("message")) {
            Some(error) => error_text(error),
            None => body.to_owned(),
        },
        Err(_) => body.to_owned(),
    }
}

fn kind_for_status(status: StatusCode) -> AiErrorKind {
    match status.as_u16() {
        401 | 403 => AiErrorKind::Unauthorized,
        404 => AiErrorKind::NotFound,
        429 => AiErrorKind::RateLimited,
        400 | 422 => AiErrorKind::BadRequest,
        _ => AiErrorKind::Http,
    }
}

async fn status_error(response: reqwest::Response, key: Option<&str>) -> AiError {
    let status = response.status();
    let body = tokio::time::timeout(MODELS_TIMEOUT, response.text())
        .await
        .ok()
        .and_then(Result::ok)
        .unwrap_or_default();
    let message = scrub(&provider_message(&body), key);
    AiError {
        kind: kind_for_status(status),
        status: Some(status.as_u16()),
        message: if message.is_empty() {
            status.to_string()
        } else {
            message
        },
    }
}

/// Splits a `text/event-stream` body into the `data` of each event. Bytes are
/// cut into lines before decoding, so a UTF-8 character split across network
/// chunks is never broken.
#[derive(Default)]
struct SseParser {
    pending: Vec<u8>,
    data: Vec<String>,
}

impl SseParser {
    fn push(&mut self, chunk: &[u8]) -> Vec<String> {
        self.pending.extend_from_slice(chunk);
        let mut events = Vec::new();
        while let Some(at) = self.pending.iter().position(|&byte| byte == b'\n') {
            let line: Vec<u8> = self.pending.drain(..=at).collect();
            self.line(&String::from_utf8_lossy(&line), &mut events);
        }
        events
    }

    /// The stream ended; some servers omit the blank line after the last event.
    fn finish(&mut self) -> Vec<String> {
        let mut events = Vec::new();
        if !self.pending.is_empty() {
            let rest = std::mem::take(&mut self.pending);
            self.line(&String::from_utf8_lossy(&rest), &mut events);
        }
        if !self.data.is_empty() {
            events.push(self.data.join("\n"));
            self.data.clear();
        }
        events
    }

    fn line(&mut self, line: &str, events: &mut Vec<String>) {
        let line = line.trim_end_matches(['\n', '\r']);
        if line.is_empty() {
            if !self.data.is_empty() {
                events.push(self.data.join("\n"));
                self.data.clear();
            }
            return;
        }
        // `event:`, `id:`, `retry:` and `:` comments carry nothing we use
        if let Some(value) = line.strip_prefix("data:") {
            self.data
                .push(value.strip_prefix(' ').unwrap_or(value).to_owned());
        }
    }
}

#[derive(Debug, PartialEq)]
enum Chunk {
    Delta(String),
    Done,
    Failed(String),
    Skip,
}

fn interpret(data: &str) -> Chunk {
    if data.trim() == "[DONE]" {
        return Chunk::Done;
    }
    let Ok(value) = serde_json::from_str::<Value>(data) else {
        return Chunk::Skip;
    };
    // OpenRouter reports an upstream failure mid-stream this way
    if let Some(error) = value.get("error") {
        return Chunk::Failed(error_text(error));
    }
    match value
        .pointer("/choices/0/delta/content")
        .and_then(Value::as_str)
    {
        Some(text) if !text.is_empty() => Chunk::Delta(text.to_owned()),
        _ => Chunk::Skip,
    }
}

/// The webview's chat completion request, passed through as is (messages may
/// carry `image_url` parts); only streaming is forced on.
fn chat_body(mut body: Value) -> Result<Vec<u8>, AiError> {
    let Some(fields) = body.as_object_mut() else {
        return Err(AiError::new(
            AiErrorKind::InvalidInput,
            "the request body must be an object",
        ));
    };
    fields.insert("stream".into(), Value::Bool(true));
    serde_json::to_vec(&body)
        .map_err(|error| AiError::new(AiErrorKind::InvalidInput, error.to_string()))
}

fn model_ids(value: &Value) -> Vec<String> {
    let mut ids: Vec<String> = value
        .get("data")
        .and_then(Value::as_array)
        .map(|models| {
            models
                .iter()
                .filter_map(|model| model.get("id").and_then(Value::as_str))
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default();
    ids.sort();
    ids.dedup();
    ids
}

fn build_client() -> Result<reqwest::Client, AiError> {
    reqwest::Client::builder()
        .use_native_tls()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|error| AiError::new(AiErrorKind::Network, error_chain(&error)))
}

fn with_key(request: reqwest::RequestBuilder, key: Option<&str>) -> reqwest::RequestBuilder {
    match key {
        Some(key) if !key.is_empty() => request.bearer_auth(key),
        _ => request,
    }
}

/// Streams one chat completion, handing each text delta to `emit`. Returns
/// once the provider says it is done, the body ends, or `emit` reports the
/// listener is gone.
async fn run_chat(
    client: reqwest::Client,
    url: Url,
    body: Vec<u8>,
    key: Option<String>,
    mut emit: impl FnMut(String) -> bool,
) -> Result<(), AiError> {
    let key = key.as_deref();
    let request = with_key(client.post(url), key)
        .header(CONTENT_TYPE, "application/json")
        .body(body);
    let response = tokio::time::timeout(STALL_TIMEOUT, request.send())
        .await
        .map_err(|_| stalled())?
        .map_err(request_error)?;
    if !response.status().is_success() {
        return Err(status_error(response, key).await);
    }

    let mut stream = response.bytes_stream();
    let mut parser = SseParser::default();
    loop {
        let next = tokio::time::timeout(STALL_TIMEOUT, stream.next())
            .await
            .map_err(|_| stalled())?;
        let ended = next.is_none();
        let events = match next {
            Some(chunk) => parser.push(&chunk.map_err(request_error)?),
            None => parser.finish(),
        };
        for data in events {
            match interpret(&data) {
                Chunk::Delta(text) => {
                    if !emit(text) {
                        return Ok(());
                    }
                }
                Chunk::Done => return Ok(()),
                Chunk::Failed(message) => {
                    return Err(AiError::new(AiErrorKind::Provider, scrub(&message, key)))
                }
                Chunk::Skip => {}
            }
        }
        if ended {
            return Ok(());
        }
    }
}

#[derive(Default)]
struct AiInner {
    client: Option<reqwest::Client>,
    next_id: u32,
    active: HashMap<u32, oneshot::Sender<()>>,
}

/// Chat streams in flight, keyed by the id `ai_chat_stream` hands out.
#[derive(Default, Clone)]
pub struct Ai(Arc<Mutex<AiInner>>);

impl Ai {
    fn client(&self) -> Result<reqwest::Client, AiError> {
        let mut inner = self.0.lock().unwrap();
        if let Some(client) = &inner.client {
            return Ok(client.clone());
        }
        let client = build_client()?;
        inner.client = Some(client.clone());
        Ok(client)
    }

    fn insert(&self, cancel: oneshot::Sender<()>) -> u32 {
        let mut inner = self.0.lock().unwrap();
        inner.next_id = inner.next_id.wrapping_add(1);
        let id = inner.next_id;
        inner.active.insert(id, cancel);
        id
    }

    fn remove(&self, id: u32) -> Option<oneshot::Sender<()>> {
        self.0.lock().unwrap().active.remove(&id)
    }
}

/// Stores the API key for the provider at `base_url` in the OS credential
/// store. There is no command that reads it back into the webview.
#[tauri::command]
pub async fn ai_key_set(base_url: String, key: String) -> Result<(), AiError> {
    let origin = key_origin(&parse_base_url(&base_url)?).ok_or_else(|| {
        AiError::new(
            AiErrorKind::InvalidInput,
            "a key is only sent over https or to this computer",
        )
    })?;
    let key = key.trim().to_owned();
    if key.is_empty() {
        return Err(AiError::new(AiErrorKind::InvalidInput, "the key is empty"));
    }
    blocking(move || {
        keyring_entry(&origin)?
            .set_password(&key)
            .map_err(keyring_error)
    })
    .await
}

#[tauri::command]
pub async fn ai_key_delete(base_url: String) -> Result<(), AiError> {
    let origin = origin_of(&parse_base_url(&base_url)?);
    blocking(move || match keyring_entry(&origin)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(keyring_error(error)),
    })
    .await
}

#[tauri::command]
pub async fn ai_key_status(base_url: String) -> Result<bool, AiError> {
    Ok(key_for(&parse_base_url(&base_url)?).await?.is_some())
}

/// `GET {base}/models`: the ids the provider offers, sorted.
#[tauri::command]
pub async fn ai_list_models(ai: State<'_, Ai>, base_url: String) -> Result<Vec<String>, AiError> {
    let base = parse_base_url(&base_url)?;
    let key = key_for(&base).await?;
    let request = with_key(ai.client()?.get(endpoint(&base, "models")), key.as_deref())
        .timeout(MODELS_TIMEOUT);
    let response = request.send().await.map_err(request_error)?;
    if !response.status().is_success() {
        return Err(status_error(response, key.as_deref()).await);
    }
    let bytes = response.bytes().await.map_err(request_error)?;
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| {
        AiError::new(
            AiErrorKind::BadRequest,
            "the address did not answer like an OpenAI-compatible API",
        )
    })?;
    Ok(model_ids(&value))
}

/// Starts `POST {base}/chat/completions` and returns its id at once; text
/// arrives on `on_event` as `delta` events, then one `done` or `error`. A
/// stream stopped with `ai_cancel` sends nothing more.
#[tauri::command]
pub async fn ai_chat_stream(
    ai: State<'_, Ai>,
    base_url: String,
    body: Value,
    on_event: Channel<AiEvent>,
) -> Result<u32, AiError> {
    let base = parse_base_url(&base_url)?;
    let body = chat_body(body)?;
    let key = key_for(&base).await?;
    let client = ai.client()?;
    let (cancel, cancelled) = oneshot::channel();
    let id = ai.insert(cancel);
    let ai = ai.inner().clone();
    async_runtime::spawn(async move {
        let url = endpoint(&base, "chat/completions");
        let deltas = on_event.clone();
        let chat = run_chat(client, url, body, key, move |text| {
            deltas.send(AiEvent::Delta { text }).is_ok()
        });
        tokio::select! {
            result = chat => {
                let _ = on_event.send(match result {
                    Ok(()) => AiEvent::Done,
                    Err(error) => AiEvent::Error(error),
                });
            }
            _ = cancelled => {}
        }
        ai.remove(id);
    });
    Ok(id)
}

/// Stops a stream. Unknown ids are fine: a finished stream has removed itself.
#[tauri::command]
pub fn ai_cancel(ai: State<'_, Ai>, id: u32) {
    if let Some(cancel) = ai.remove(id) {
        let _ = cancel.send(());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn http_is_only_allowed_on_this_machine_and_the_local_network() {
        assert!(parse_base_url("http://localhost:11434/v1").is_ok());
        assert!(parse_base_url("http://127.0.0.1:1234/v1").is_ok());
        assert!(parse_base_url("http://[::1]:1234/v1").is_ok());
        assert!(parse_base_url("http://192.168.1.5:11434/v1").is_ok());
        assert!(parse_base_url("http://100.101.102.103:11434/v1").is_ok());
        assert!(parse_base_url("http://studio.local:11434/v1").is_ok());
        assert!(parse_base_url("https://openrouter.ai/api/v1").is_ok());
        assert!(parse_base_url("https://mac.tail1234.ts.net/v1").is_ok());

        assert!(parse_base_url("http://api.openai.com/v1").is_err());
        assert!(parse_base_url("http://8.8.8.8/v1").is_err());
        assert!(parse_base_url("http://localhost.evil.com/v1").is_err());
        assert!(parse_base_url("http://127.0.0.1.evil.com/v1").is_err());
        assert!(parse_base_url("http://192.168.1.5.evil.com/v1").is_err());
        assert!(parse_base_url("http://homeserver:11434/v1").is_err());
        assert!(parse_base_url("http://mac.tail1234.ts.net/v1").is_err());
        assert!(parse_base_url("http://.local/v1").is_err());
        assert!(parse_base_url("ftp://localhost/v1").is_err());
        assert!(parse_base_url("https://user:pass@openrouter.ai/api/v1").is_err());
        assert!(parse_base_url("https://openrouter.ai/api/v1?x=1").is_err());
        assert!(parse_base_url("not a url").is_err());
    }

    #[test]
    fn a_names_hint_points_to_the_ip_address() {
        let error = parse_base_url("http://homeserver:11434/v1").unwrap_err();
        assert!(error.message.contains("IP address"), "{}", error.message);
    }

    #[test]
    fn private_ranges_end_at_their_boundaries() {
        let at = |ip: &str| ip_reach(ip.parse().unwrap());
        assert_eq!(at("127.0.0.1"), Reach::Loopback);
        assert_eq!(at("::ffff:127.0.0.1"), Reach::Loopback);
        assert_eq!(at("10.0.0.1"), Reach::PrivateNetwork);
        assert_eq!(at("172.16.0.1"), Reach::PrivateNetwork);
        assert_eq!(at("172.31.255.255"), Reach::PrivateNetwork);
        assert_eq!(at("172.32.0.1"), Reach::Unknown);
        assert_eq!(at("172.15.0.1"), Reach::Unknown);
        assert_eq!(at("192.168.0.1"), Reach::PrivateNetwork);
        assert_eq!(at("192.169.0.1"), Reach::Unknown);
        assert_eq!(at("169.254.1.1"), Reach::PrivateNetwork);
        assert_eq!(at("100.64.0.1"), Reach::PrivateNetwork);
        assert_eq!(at("100.127.255.255"), Reach::PrivateNetwork);
        assert_eq!(at("100.128.0.1"), Reach::Unknown);
        assert_eq!(at("100.63.0.1"), Reach::Unknown);
        assert_eq!(at("::ffff:192.168.1.5"), Reach::PrivateNetwork);
        assert_eq!(at("fd12:3456::1"), Reach::PrivateNetwork);
        assert_eq!(at("fe80::1"), Reach::PrivateNetwork);
        assert_eq!(at("fec0::1"), Reach::Unknown);
        assert_eq!(at("2001:db8::1"), Reach::Unknown);
        assert_eq!(at("8.8.8.8"), Reach::Unknown);
    }

    #[test]
    fn a_key_is_never_sent_over_http_on_the_local_network() {
        let stored = |_: &str| Ok(Some("sk-stored".to_owned()));
        let key = |raw: &str| key_for_with(&parse_base_url(raw).unwrap(), stored).unwrap();

        assert_eq!(key("http://192.168.1.5:11434/v1"), None);
        assert_eq!(key("http://100.101.102.103:11434/v1"), None);
        assert_eq!(key("http://studio.local:11434/v1"), None);
        assert_eq!(key("http://[fd12:3456::1]:11434/v1"), None);

        assert_eq!(
            key("http://localhost:11434/v1").as_deref(),
            Some("sk-stored")
        );
        assert_eq!(key("https://192.168.1.5/v1").as_deref(), Some("sk-stored"));
        assert_eq!(
            key("https://openrouter.ai/api/v1").as_deref(),
            Some("sk-stored")
        );
    }

    #[test]
    fn a_key_cannot_be_saved_for_http_on_the_local_network() {
        let error = async_runtime::block_on(ai_key_set(
            "http://192.168.1.5:11434/v1".into(),
            "sk-test".into(),
        ))
        .unwrap_err();
        assert_eq!(error.kind, AiErrorKind::InvalidInput);
    }

    #[test]
    fn keys_are_stored_by_normalized_origin() {
        let origin = |raw: &str| origin_of(&parse_base_url(raw).unwrap());
        assert_eq!(
            origin("https://OpenRouter.ai:443/api/v1/"),
            "https://openrouter.ai"
        );
        assert_eq!(
            origin("https://openrouter.ai/other"),
            "https://openrouter.ai"
        );
        assert_eq!(
            origin("http://localhost:11434/v1"),
            "http://localhost:11434"
        );
        assert_ne!(
            origin("http://localhost:11434/v1"),
            origin("http://localhost:1234/v1")
        );
    }

    #[test]
    fn endpoints_join_with_or_without_a_trailing_slash() {
        let base = parse_base_url("https://openrouter.ai/api/v1/").unwrap();
        assert_eq!(
            endpoint(&base, "models").as_str(),
            "https://openrouter.ai/api/v1/models"
        );
        let base = parse_base_url("http://localhost:11434/v1").unwrap();
        assert_eq!(
            endpoint(&base, "chat/completions").as_str(),
            "http://localhost:11434/v1/chat/completions"
        );
    }

    #[test]
    fn sse_events_are_split_across_and_within_chunks() {
        let mut parser = SseParser::default();
        assert_eq!(
            parser.push(b"data: one\n\ndata: two\r\n\r\n: comment\nevent: x\ndata: thr"),
            vec!["one", "two"]
        );
        assert_eq!(parser.push(b"ee\n"), Vec::<String>::new());
        assert_eq!(parser.push(b"\n"), vec!["three"]);
        assert_eq!(parser.push(b"data:a\ndata:b\n\n"), vec!["a\nb"]);
    }

    #[test]
    fn a_character_split_between_chunks_survives() {
        let bytes = "data: привет\n\n".as_bytes();
        let mut parser = SseParser::default();
        assert!(parser.push(&bytes[..8]).is_empty());
        assert_eq!(parser.push(&bytes[8..]), vec!["привет"]);
    }

    #[test]
    fn a_stream_without_the_last_blank_line_is_flushed() {
        let mut parser = SseParser::default();
        assert!(parser.push(b"data: last").is_empty());
        assert_eq!(parser.finish(), vec!["last"]);
    }

    #[test]
    fn chunks_are_read_as_deltas_done_or_errors() {
        assert_eq!(
            interpret(r#"{"choices":[{"delta":{"content":"Hi"}}]}"#),
            Chunk::Delta("Hi".into())
        );
        assert_eq!(
            interpret(r#"{"choices":[{"delta":{"role":"assistant"}}]}"#),
            Chunk::Skip
        );
        assert_eq!(interpret(" [DONE] "), Chunk::Done);
        assert_eq!(
            interpret(r#"{"error":{"message":"upstream failed"}}"#),
            Chunk::Failed("upstream failed".into())
        );
        assert_eq!(interpret("garbage"), Chunk::Skip);
    }

    #[test]
    fn the_body_is_passed_through_with_streaming_on() {
        let body = serde_json::json!({
            "model": "gemma3",
            "stream": false,
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": "name this"},
                {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,AAAA"}}
            ]}]
        });
        let sent: Value = serde_json::from_slice(&chat_body(body.clone()).unwrap()).unwrap();
        assert_eq!(sent["stream"], Value::Bool(true));
        assert_eq!(sent["messages"], body["messages"]);
        assert!(chat_body(serde_json::json!([1])).is_err());
    }

    #[test]
    fn provider_errors_are_extracted_and_scrubbed() {
        assert_eq!(
            provider_message(r#"{"error":{"message":"bad key"}}"#),
            "bad key"
        );
        assert_eq!(
            provider_message(r#"{"error":"model not found"}"#),
            "model not found"
        );
        assert_eq!(provider_message("plain text"), "plain text");
        assert_eq!(
            scrub("key sk-secret is wrong", Some("sk-secret")),
            "key *** is wrong"
        );
        assert_eq!(
            kind_for_status(StatusCode::UNAUTHORIZED),
            AiErrorKind::Unauthorized
        );
        assert_eq!(
            kind_for_status(StatusCode::TOO_MANY_REQUESTS),
            AiErrorKind::RateLimited
        );
        assert_eq!(
            kind_for_status(StatusCode::BAD_REQUEST),
            AiErrorKind::BadRequest
        );
        assert_eq!(kind_for_status(StatusCode::BAD_GATEWAY), AiErrorKind::Http);
    }

    #[test]
    fn a_key_straddling_the_length_limit_is_still_hidden() {
        let key = "sk-0123456789abcdef";
        let text = format!("{}{key} trailing", "x".repeat(DETAIL_LIMIT - 5));
        let scrubbed = scrub(&text, Some(key));
        assert!(!scrubbed.contains("sk-01"), "{scrubbed}");
        assert_eq!(scrubbed.chars().count(), DETAIL_LIMIT);
    }

    #[test]
    fn model_ids_are_sorted_and_unique() {
        let value = serde_json::json!({"data": [{"id": "b"}, {"id": "a"}, {"id": "b"}, {}]});
        assert_eq!(model_ids(&value), vec!["a", "b"]);
        assert!(model_ids(&serde_json::json!({})).is_empty());
    }

    /// Answers one request with `response` and returns the request head.
    fn serve_one(
        listener: TcpListener,
        response: &'static [u8],
    ) -> std::thread::JoinHandle<String> {
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 16 * 1024];
            let head_end = loop {
                let read = socket.read(&mut buffer).unwrap();
                received.extend_from_slice(&buffer[..read]);
                if let Some(at) = received.windows(4).position(|w| w == b"\r\n\r\n") {
                    break at + 4;
                }
            };
            let head = String::from_utf8_lossy(&received[..head_end]).to_lowercase();
            let length: usize = head
                .lines()
                .find_map(|line| line.strip_prefix("content-length:"))
                .map(|value| value.trim().parse().unwrap())
                .unwrap_or(0);
            while received.len() < head_end + length {
                let read = socket.read(&mut buffer).unwrap();
                received.extend_from_slice(&buffer[..read]);
            }
            socket.write_all(response).unwrap();
            head
        })
    }

    fn local_url(listener: &TcpListener) -> Url {
        Url::parse(&format!(
            "http://{}/v1/chat/completions",
            listener.local_addr().unwrap()
        ))
        .unwrap()
    }

    #[test]
    fn a_stream_is_read_to_the_end_with_the_key_attached() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = local_url(&listener);
        let server = serve_one(
            listener,
            b"HTTP/1.1 200 OK\r\ncontent-type: text/event-stream\r\nconnection: close\r\n\r\n\
data: {\"choices\":[{\"delta\":{\"role\":\"assistant\"}}]}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"Hel\"}}]}\n\n\
data: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\n\
data: [DONE]\n\n",
        );

        let mut text = String::new();
        let result = async_runtime::block_on(run_chat(
            build_client().unwrap(),
            url,
            chat_body(serde_json::json!({"model": "m"})).unwrap(),
            Some("sk-test".into()),
            |delta| {
                text.push_str(&delta);
                true
            },
        ));

        result.unwrap();
        assert_eq!(text, "Hello");
        let head = server.join().unwrap();
        assert!(
            head.starts_with("post /v1/chat/completions http/1.1"),
            "{head}"
        );
        assert!(head.contains("authorization: bearer sk-test"), "{head}");
    }

    #[test]
    fn a_rejected_request_reports_the_provider_text_without_the_key() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = local_url(&listener);
        let server = serve_one(
            listener,
            b"HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\ncontent-length: 52\r\nconnection: close\r\n\r\n\
{\"error\":{\"message\":\"Incorrect API key: sk-test\"}}\n\n",
        );

        let error = async_runtime::block_on(run_chat(
            build_client().unwrap(),
            url,
            chat_body(serde_json::json!({"model": "m"})).unwrap(),
            Some("sk-test".into()),
            |_| true,
        ))
        .unwrap_err();
        server.join().unwrap();

        assert_eq!(error.kind, AiErrorKind::Unauthorized);
        assert_eq!(error.status, Some(401));
        assert_eq!(error.message, "Incorrect API key: ***");
    }

    #[test]
    fn a_refused_connection_is_a_connect_error() {
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let url = Url::parse(&format!("http://127.0.0.1:{port}/v1/chat/completions")).unwrap();
        let error = async_runtime::block_on(run_chat(
            build_client().unwrap(),
            url,
            chat_body(serde_json::json!({"model": "m"})).unwrap(),
            None,
            |_| true,
        ))
        .unwrap_err();
        assert_eq!(error.kind, AiErrorKind::Connect);
    }
}

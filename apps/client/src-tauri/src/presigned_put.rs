use std::collections::HashMap;
use std::error::Error;
use std::sync::Mutex;
use std::time::Duration;

use bytes::Bytes;
use tauri::async_runtime::{self, JoinHandle};
use tauri::ipc::{InvokeBody, Request};
use tauri::State;
use tokio::sync::mpsc;

/// Host of the presigned PUT URLs the backend issues. Anything else is refused:
/// these commands are a raw byte pipe, not a general HTTP client.
const STORAGE_HOST: &str = "s3.us-east-005.backblazeb2.com";

/// How long one chunk (or the final response) may wait before the upload is
/// treated as stalled. Connect and per-chunk waits are bounded; the whole
/// upload is not, since a large file on a slow link legitimately takes long.
const STALL_TIMEOUT: Duration = Duration::from_secs(60);

/// Prefix of a failure to reach storage at all. Nothing was sent, so the
/// caller may safely start the same upload again.
const CONNECT_FAILED: &str = "blob upload could not connect";

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

struct Upload {
    chunks: mpsc::Sender<Bytes>,
    task: JoinHandle<Result<(), String>>,
}

#[derive(Default)]
struct UploadsInner {
    next_id: u32,
    active: HashMap<u32, Upload>,
    /// one client for every upload: its pool keeps connections alive, so a
    /// copy of hundreds of files does not pay a TCP + TLS handshake per file
    client: Option<reqwest::Client>,
}

/// Uploads in flight, keyed by the id `put_presigned_start` hands out.
#[derive(Default)]
pub struct Uploads(Mutex<UploadsInner>);

impl Uploads {
    fn client(&self) -> Result<reqwest::Client, String> {
        let mut inner = self.0.lock().unwrap();
        if let Some(client) = &inner.client {
            return Ok(client.clone());
        }
        let client = build_client()?;
        inner.client = Some(client.clone());
        Ok(client)
    }

    fn insert(&self, upload: Upload) -> u32 {
        let mut inner = self.0.lock().unwrap();
        inner.next_id = inner.next_id.wrapping_add(1);
        let id = inner.next_id;
        inner.active.insert(id, upload);
        id
    }

    fn sender(&self, id: u32) -> Option<mpsc::Sender<Bytes>> {
        self.0
            .lock()
            .unwrap()
            .active
            .get(&id)
            .map(|upload| upload.chunks.clone())
    }

    fn remove(&self, id: u32) -> Option<Upload> {
        self.0.lock().unwrap().active.remove(&id)
    }
}

fn storage_url(url: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(url).map_err(|error| error.to_string())?;
    if parsed.scheme() != "https" || parsed.host_str() != Some(STORAGE_HOST) {
        return Err("upload url is not the storage endpoint".into());
    }
    Ok(parsed)
}

fn build_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .use_native_tls()
        .http1_only()
        .redirect(reqwest::redirect::Policy::none())
        .connect_timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error_chain(&error))
}

/// The message never carries the URL: a presigned one holds its signature,
/// and it only buries the cause in the dialog.
fn send_error(error: reqwest::Error) -> String {
    let connect = error.is_connect();
    let message = error_chain(&error.without_url());
    if connect {
        format!("{CONNECT_FAILED}: {message}")
    } else {
        message
    }
}

/// Starts the PUT with a body fed chunk by chunk. The channel holds one chunk,
/// so a send returns only once reqwest has taken the previous one: memory
/// stays at a couple of chunks whatever the file size, and each acknowledged
/// chunk is honest upload progress for the caller.
fn spawn_put(
    client: reqwest::Client,
    url: reqwest::Url,
    content_type: String,
    size: u64,
) -> Upload {
    let (chunks, receiver) = mpsc::channel::<Bytes>(1);
    let body = reqwest::Body::wrap_stream(futures_util::stream::unfold(
        receiver,
        |mut receiver| async move {
            let chunk = receiver.recv().await?;
            Some((Ok::<_, std::io::Error>(chunk), receiver))
        },
    ));
    let task = async_runtime::spawn(async move {
        // presigned S3 PUTs refuse chunked transfer encoding; an explicit
        // length makes hyper send a plain body and fail if the chunks fall short
        let response = client
            .put(url)
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .header(reqwest::header::CONTENT_LENGTH, size)
            .body(body)
            .send()
            .await
            .map_err(send_error)?;
        let status = response.status();
        if status.is_success() {
            return Ok(());
        }
        let detail = response.text().await.unwrap_or_default();
        let detail = detail.trim();
        Err(if detail.is_empty() {
            format!("blob upload failed: {status}")
        } else {
            format!("blob upload failed: {status} {detail}")
        })
    });
    Upload { chunks, task }
}

/// The request's own error once its task has ended early (the receiver is
/// gone, so a chunk could not be queued).
async fn ended_error(upload: Option<Upload>) -> String {
    let Some(upload) = upload else {
        return "unknown upload".into();
    };
    drop(upload.chunks);
    match tokio::time::timeout(STALL_TIMEOUT, upload.task).await {
        Ok(Ok(Err(error))) => error,
        Ok(Ok(Ok(()))) => "blob upload ended before all bytes were sent".into(),
        Ok(Err(error)) => error.to_string(),
        Err(_) => "blob upload stalled".into(),
    }
}

/// Opens a streaming PUT to a presigned storage URL and returns its id.
///
/// The webview cannot finish this request: its origin is `tauri://localhost`,
/// and the bucket only reflects http(s) origins. Bucket CORS cannot fix it:
/// the rule is already `allowedOrigins: ["*"]`, yet a preflight from
/// `tauri://localhost` gets `access-control-allow-origin: null` (checked
/// 2026-09-29; `https://…` and `http://tauri.localhost` are echoed back).
/// macOS ignores `useHttpsScheme`, so the origin cannot move to http(s).
///
/// The HTTP plugin's client reached the socket and failed before a status
/// came back (`error sending request`), hiding the cause. This uses the
/// system TLS stack and HTTP/1.1; the bytes follow through
/// `put_presigned_chunk` as raw IPC bodies so a file is never held whole in
/// memory nor re-encoded as a JSON array of numbers.
#[tauri::command]
pub fn put_presigned_start(
    uploads: State<'_, Uploads>,
    url: String,
    content_type: String,
    size: u64,
) -> Result<u32, String> {
    let upload = spawn_put(uploads.client()?, storage_url(&url)?, content_type, size);
    Ok(uploads.insert(upload))
}

/// Queues the next slice of the file (raw body, id in `x-upload-id`). Returns
/// once the previous slice has been handed to the connection.
#[tauri::command]
pub async fn put_presigned_chunk(
    uploads: State<'_, Uploads>,
    request: Request<'_>,
) -> Result<(), String> {
    let id: u32 = request
        .headers()
        .get("x-upload-id")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse().ok())
        .ok_or("missing upload id")?;
    let bytes = match request.body() {
        InvokeBody::Raw(bytes) => Bytes::copy_from_slice(bytes),
        InvokeBody::Json(_) => return Err("expected the file bytes".into()),
    };
    let chunks = uploads.sender(id).ok_or("unknown upload")?;
    match tokio::time::timeout(STALL_TIMEOUT, chunks.send(bytes)).await {
        Ok(Ok(())) => Ok(()),
        Ok(Err(_)) => Err(ended_error(uploads.remove(id)).await),
        Err(_) => {
            if let Some(upload) = uploads.remove(id) {
                upload.task.abort();
            }
            Err("blob upload stalled".into())
        }
    }
}

/// Ends the body and waits for storage to answer.
#[tauri::command]
pub async fn put_presigned_finish(uploads: State<'_, Uploads>, id: u32) -> Result<(), String> {
    let upload = uploads.remove(id).ok_or("unknown upload")?;
    drop(upload.chunks);
    match tokio::time::timeout(STALL_TIMEOUT, upload.task).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => Err("blob upload stalled".into()),
    }
}

/// Drops an upload the caller gave up on. Unknown ids are fine: a failed
/// chunk or finish has already removed it.
#[tauri::command]
pub fn put_presigned_abort(uploads: State<'_, Uploads>, id: u32) {
    if let Some(upload) = uploads.remove(id) {
        upload.task.abort();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    #[test]
    fn only_https_storage_urls_are_accepted() {
        assert!(storage_url(&format!("https://{STORAGE_HOST}/bucket/key?sig=1")).is_ok());
        assert!(storage_url(&format!("http://{STORAGE_HOST}/bucket/key")).is_err());
        assert!(storage_url("https://example.com/bucket/key").is_err());
        assert!(storage_url(&format!("https://{STORAGE_HOST}.example.com/key")).is_err());
        assert!(storage_url("not a url").is_err());
    }

    /// Reads one HTTP/1.1 request with a Content-Length body, answers 200 and
    /// returns the raw head and the body.
    fn serve_one(listener: TcpListener) -> std::thread::JoinHandle<(String, Vec<u8>)> {
        std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut received = Vec::new();
            let mut buffer = [0u8; 64 * 1024];
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
                .expect("no content-length");
            while received.len() < head_end + length {
                let read = socket.read(&mut buffer).unwrap();
                received.extend_from_slice(&buffer[..read]);
            }
            socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\n\r\n")
                .unwrap();
            (head, received[head_end..].to_vec())
        })
    }

    #[test]
    fn chunks_arrive_as_one_sized_body() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/put", listener.local_addr().unwrap());
        let server = serve_one(listener);

        let parts: [&[u8]; 3] = [b"hello ", b"streamed ", b"world"];
        let size: usize = parts.iter().map(|part| part.len()).sum();
        async_runtime::block_on(async {
            let upload = spawn_put(
                build_client().unwrap(),
                reqwest::Url::parse(&url).unwrap(),
                "video/mp4".into(),
                size as u64,
            );
            for part in parts {
                upload.chunks.send(Bytes::from_static(part)).await.unwrap();
            }
            drop(upload.chunks);
            upload.task.await.unwrap().unwrap();
        });

        let (head, body) = server.join().unwrap();
        assert!(head.starts_with("put /put http/1.1"));
        assert!(head.contains("content-type: video/mp4"));
        assert!(!head.contains("transfer-encoding"));
        assert_eq!(body, b"hello streamed world");
    }

    #[test]
    fn a_refused_connection_is_marked_retryable_and_hides_the_url() {
        // bind then drop: nothing listens on the port any more
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let url = format!("http://127.0.0.1:{port}/put?X-Amz-Signature=secret");

        let error = async_runtime::block_on(async {
            let upload = spawn_put(
                build_client().unwrap(),
                reqwest::Url::parse(&url).unwrap(),
                "image/png".into(),
                1,
            );
            let _ = upload.chunks.send(Bytes::from_static(b"x")).await;
            drop(upload.chunks);
            upload.task.await.unwrap().unwrap_err()
        });

        assert!(error.starts_with(CONNECT_FAILED), "{error}");
        assert!(!error.contains("secret"), "{error}");
    }
}

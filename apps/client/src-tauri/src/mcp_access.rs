//! Local agent access (MCP plan, slices 1.1 and 1.3).
//!
//! Turning access on writes a token file and binds a Unix socket, both mode
//! `0600`, in the app data directory. The first line of a connection is the
//! token. A wrong or empty line closes the socket. After a matching line the
//! raw bytes are forwarded to the WebView and back; this process does not
//! read JSON-RPC. `mcp_realpath` is `std::fs::canonicalize`.

use std::fs::{self, File, OpenOptions};
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const TOKEN_FILE: &str = "mcp.token";
const SOCKET_FILE: &str = "mcp.sock";
const VERSION_FILE: &str = "mcp.version";
const OWNER_ONLY: u32 = 0o600;
/// Hex token is 64 characters. Longer first lines are refused.
const MAX_TOKEN_LINE: usize = 128;
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(5);
/// How often the accept loop looks at `stop`. Short enough that Exit does not
/// wait on a socket path that another process may have replaced.
const ACCEPT_POLL: Duration = Duration::from_millis(50);
const WRITE_TIMEOUT: Duration = Duration::from_secs(5);

/// Bytes after the token line, and the close of that connection.
/// The WebView parses MCP; this process only moves the bytes.
trait SessionIo: Send + Sync {
    fn bytes(&self, id: u64, data: &[u8]);
    fn close(&self, id: u64);
}

struct SilentIo;

impl SessionIo for SilentIo {
    fn bytes(&self, _id: u64, _data: &[u8]) {}
    fn close(&self, _id: u64) {}
}

struct EmitIo(AppHandle);

#[derive(Clone, Serialize)]
struct McpSessionBytes {
    id: u64,
    bytes: Vec<u8>,
}

#[derive(Clone, Serialize)]
struct McpSessionClose {
    id: u64,
}

impl SessionIo for EmitIo {
    fn bytes(&self, id: u64, data: &[u8]) {
        let _ = self.0.emit(
            "mcp-session-bytes",
            McpSessionBytes {
                id,
                bytes: data.to_vec(),
            },
        );
    }

    fn close(&self, id: u64) {
        let _ = self.0.emit("mcp-session-close", McpSessionClose { id });
    }
}

pub struct Access {
    inner: Mutex<Option<Running>>,
}

struct Running {
    dir: PathBuf,
    stop: Arc<AtomicBool>,
    thread: Option<JoinHandle<()>>,
    /// Clones of accepted streams. `stop_listener` shuts them down so a
    /// client blocked in `read` sees EOF, not only the accept loop.
    #[cfg(unix)]
    streams: Arc<Mutex<Vec<(u64, std::os::unix::net::UnixStream)>>>,
}

impl Default for Access {
    fn default() -> Self {
        Self {
            inner: Mutex::new(None),
        }
    }
}

impl Drop for Access {
    fn drop(&mut self) {
        self.shutdown();
    }
}

impl Access {
    /// Stops the listener, if it is running, and deletes the socket and the token.
    pub fn shutdown(&self) {
        let running = self.inner.lock().expect("mcp access").take();
        if let Some(running) = running {
            stop_listener(running);
        }
    }

    pub fn set_enabled(&self, dir: &Path, enabled: bool) -> io::Result<()> {
        self.set_enabled_with(dir, enabled, Arc::new(SilentIo))
    }

    fn set_enabled_with(
        &self,
        dir: &Path,
        enabled: bool,
        io: Arc<dyn SessionIo>,
    ) -> io::Result<()> {
        if !enabled {
            self.shutdown();
            // Our files are already gone. A live socket here belongs to
            // another instance; clear_stale_socket leaves it and its token.
            let _ = clear_stale_socket(dir);
            return Ok(());
        }

        let mut guard = self.inner.lock().expect("mcp access");
        if guard.is_some() {
            return Ok(());
        }

        start(dir, io).map(|running| {
            *guard = Some(running);
        })
    }

    /// Writes raw bytes to an accepted session. Unknown ids are an error.
    /// The socket locks are released before the write, so a client that does
    /// not read cannot block shutdown.
    #[cfg(unix)]
    pub fn write_session(&self, id: u64, bytes: &[u8]) -> io::Result<()> {
        let mut stream = self.clone_session(id)?;
        write_with_timeout(&mut stream, bytes)
    }

    #[cfg(not(unix))]
    pub fn write_session(&self, id: u64, bytes: &[u8]) -> io::Result<()> {
        let _ = (id, bytes);
        Err(io::Error::new(
            ErrorKind::Unsupported,
            "agent access uses a unix socket",
        ))
    }

    #[cfg(unix)]
    fn clone_session(&self, id: u64) -> io::Result<std::os::unix::net::UnixStream> {
        let guard = self.inner.lock().expect("mcp access");
        let Some(running) = guard.as_ref() else {
            return Err(io::Error::new(ErrorKind::NotFound, "session"));
        };
        let streams = match running.streams.lock() {
            Ok(guard) => guard,
            Err(poisoned) => poisoned.into_inner(),
        };
        let Some((_, stream)) = streams.iter().find(|(sid, _)| *sid == id) else {
            return Err(io::Error::new(ErrorKind::NotFound, "session"));
        };
        stream.try_clone()
    }
}

/// Drops a socket and token left by a crashed process.
///
/// A socket that still accepts connections belongs to another instance
/// (this app and an installed copy share one identifier). It is left in
/// place, and so is its token.
pub fn clear_stale_socket(dir: &Path) -> io::Result<()> {
    if socket_is_live(dir) {
        return Ok(());
    }
    remove_access_files(dir)
}

#[tauri::command]
pub fn mcp_set_access(
    app: AppHandle,
    access: State<'_, Access>,
    enabled: bool,
) -> Result<(), String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    access
        .set_enabled_with(&dir, enabled, Arc::new(EmitIo(app)))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn mcp_session_write(
    access: State<'_, Access>,
    id: u64,
    bytes: Vec<u8>,
) -> Result<(), String> {
    // Clone under the locks here, on the async runtime. The write itself
    // blocks up to WRITE_TIMEOUT and must not run on the main thread.
    #[cfg(unix)]
    {
        let mut stream = access
            .clone_session(id)
            .map_err(|error| error.to_string())?;
        return tauri::async_runtime::spawn_blocking(move || {
            write_with_timeout(&mut stream, &bytes)
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string());
    }
    #[cfg(not(unix))]
    {
        let _ = (access, id, bytes);
        Err("agent access uses a unix socket".to_string())
    }
}

#[cfg(unix)]
fn write_with_timeout(stream: &mut std::os::unix::net::UnixStream, bytes: &[u8]) -> io::Result<()> {
    if let Err(error) = stream.set_write_timeout(Some(WRITE_TIMEOUT)) {
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return Err(error);
    }
    // A timed-out write can still return a short `Ok`. The next call would
    // wait out the timeout again, so the whole attempt stops at one period.
    let started = Instant::now();
    let mut rest = bytes;
    while !rest.is_empty() {
        if started.elapsed() >= WRITE_TIMEOUT {
            let _ = stream.shutdown(std::net::Shutdown::Both);
            return Err(io::Error::new(ErrorKind::TimedOut, "session write"));
        }
        match stream.write(rest) {
            Ok(0) => {
                let _ = stream.shutdown(std::net::Shutdown::Both);
                return Err(io::Error::new(ErrorKind::WriteZero, "session write"));
            }
            Ok(n) => rest = &rest[n..],
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => {
                let _ = stream.shutdown(std::net::Shutdown::Both);
                return Err(error);
            }
        }
    }
    if let Err(error) = stream.flush() {
        let _ = stream.shutdown(std::net::Shutdown::Both);
        return Err(error);
    }
    Ok(())
}

/// Resolves symlinks. A path that does not exist is an error, not the path unchanged.
#[tauri::command]
pub fn mcp_realpath(path: String) -> Result<String, String> {
    canonicalize_path(Path::new(&path))
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

pub fn canonicalize_path(path: &Path) -> io::Result<PathBuf> {
    fs::canonicalize(path)
}

#[cfg(unix)]
fn other_instance() -> io::Error {
    io::Error::new(ErrorKind::AddrInUse, "other_instance")
}

#[cfg(unix)]
fn socket_is_live(dir: &Path) -> bool {
    std::os::unix::net::UnixStream::connect(socket_path(dir)).is_ok()
}

#[cfg(not(unix))]
fn socket_is_live(_dir: &Path) -> bool {
    false
}

fn remove_file_if_exists(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn token_path(dir: &Path) -> PathBuf {
    dir.join(TOKEN_FILE)
}

fn socket_path(dir: &Path) -> PathBuf {
    dir.join(SOCKET_FILE)
}

fn version_path(dir: &Path) -> PathBuf {
    dir.join(VERSION_FILE)
}

fn remove_access_files(dir: &Path) -> io::Result<()> {
    remove_file_if_exists(&socket_path(dir))?;
    remove_file_if_exists(&token_path(dir))?;
    remove_file_if_exists(&version_path(dir))?;
    Ok(())
}

/// The whole first line, and only that, must equal the token.
fn accepted(line: &str, token: &str) -> bool {
    !line.is_empty() && line == token
}

#[cfg(unix)]
fn start(dir: &Path, io: Arc<dyn SessionIo>) -> io::Result<Running> {
    fs::create_dir_all(dir)?;
    if socket_is_live(dir) {
        return Err(other_instance());
    }
    // The previous process crashed, or never removed its files.
    remove_access_files(dir)?;
    let token = random_token()?;
    if let Err(error) = write_secret(&token_path(dir), token.as_bytes()) {
        let _ = remove_access_files(dir);
        return Err(error);
    }
    let version = format!("{}\n", env!("CARGO_PKG_VERSION"));
    if let Err(error) = write_secret(&version_path(dir), version.as_bytes()) {
        let _ = remove_access_files(dir);
        return Err(error);
    }
    let listener = match bind_socket(&socket_path(dir)) {
        Ok(listener) => listener,
        Err(error) => {
            let _ = remove_access_files(dir);
            return Err(error);
        }
    };
    let stop = Arc::new(AtomicBool::new(false));
    let streams = Arc::new(Mutex::new(Vec::new()));
    let stop_for_thread = Arc::clone(&stop);
    let streams_for_thread = Arc::clone(&streams);
    let io_for_thread = Arc::clone(&io);
    let thread = thread::Builder::new()
        .name("mcp-access".into())
        .spawn(move || {
            serve(
                listener,
                token,
                stop_for_thread,
                streams_for_thread,
                io_for_thread,
            )
        })?;
    Ok(Running {
        dir: dir.to_path_buf(),
        stop,
        thread: Some(thread),
        streams,
    })
}

#[cfg(not(unix))]
fn start(_dir: &Path, _io: Arc<dyn SessionIo>) -> io::Result<Running> {
    Err(io::Error::new(
        ErrorKind::Unsupported,
        "agent access uses a unix socket",
    ))
}

#[cfg(unix)]
fn stop_listener(mut running: Running) {
    running.stop.store(true, Ordering::SeqCst);
    if let Some(thread) = running.thread.take() {
        let _ = thread.join();
    }
    let tracked = match running.streams.lock() {
        Ok(mut guard) => std::mem::take(&mut *guard),
        Err(poisoned) => std::mem::take(&mut *poisoned.into_inner()),
    };
    for (_, stream) in tracked {
        let _ = stream.shutdown(std::net::Shutdown::Both);
    }
    // After the listener is dropped, a path that still accepts belongs to
    // another instance that replaced the file. Leave that pair alone.
    if !socket_is_live(&running.dir) {
        let _ = remove_access_files(&running.dir);
    }
}

#[cfg(not(unix))]
fn stop_listener(_running: Running) {}

#[cfg(unix)]
fn serve(
    listener: std::os::unix::net::UnixListener,
    token: String,
    stop: Arc<AtomicBool>,
    streams: Arc<Mutex<Vec<(u64, std::os::unix::net::UnixStream)>>>,
    io: Arc<dyn SessionIo>,
) {
    if listener.set_nonblocking(true).is_err() {
        return;
    }
    let mut next_id = 0u64;
    while !stop.load(Ordering::SeqCst) {
        match listener.accept() {
            Ok((stream, _)) => {
                if stop.load(Ordering::SeqCst) {
                    break;
                }
                if stream.set_nonblocking(false).is_err() {
                    continue;
                }
                let Ok(watched) = stream.try_clone() else {
                    continue;
                };
                let id = next_id;
                next_id = next_id.wrapping_add(1);
                match streams.lock() {
                    Ok(mut guard) => guard.push((id, watched)),
                    Err(poisoned) => poisoned.into_inner().push((id, watched)),
                }
                let token = token.clone();
                let streams = Arc::clone(&streams);
                let io = Arc::clone(&io);
                thread::spawn(move || {
                    session(stream, &token, id, io);
                    release_stream(&streams, id);
                });
            }
            Err(error) if accept_would_block(&error) => {
                thread::sleep(ACCEPT_POLL);
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

#[cfg(unix)]
fn accept_would_block(error: &io::Error) -> bool {
    error.kind() == ErrorKind::WouldBlock || error.kind() == ErrorKind::TimedOut
}

#[cfg(unix)]
fn release_stream(streams: &Mutex<Vec<(u64, std::os::unix::net::UnixStream)>>, id: u64) {
    let mut guard = match streams.lock() {
        Ok(guard) => guard,
        Err(poisoned) => poisoned.into_inner(),
    };
    guard.retain(|(tracked, _)| *tracked != id);
}

#[cfg(unix)]
fn session(
    mut stream: std::os::unix::net::UnixStream,
    token: &str,
    id: u64,
    io: Arc<dyn SessionIo>,
) {
    let line = match read_first_line(&mut stream) {
        Ok(Some(line)) => line,
        _ => return,
    };
    if !accepted(&line, token) {
        return;
    }
    // The token line is not part of MCP. Everything after it is forwarded raw.
    let _ = stream.set_read_timeout(None);
    let mut buf = [0u8; 8192];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => io.bytes(id, &buf[..n]),
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
    io.close(id);
}

#[cfg(unix)]
fn read_first_line(stream: &mut std::os::unix::net::UnixStream) -> io::Result<Option<String>> {
    stream.set_read_timeout(Some(HANDSHAKE_TIMEOUT))?;
    let mut line = Vec::new();
    let mut byte = [0u8; 1];
    loop {
        match stream.read(&mut byte) {
            Ok(0) => return Ok(None),
            Ok(_) if byte[0] == b'\n' => break,
            Ok(_) => {
                line.push(byte[0]);
                if line.len() > MAX_TOKEN_LINE {
                    return Ok(None);
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(error) => return Err(error),
        }
    }
    if line.last() == Some(&b'\r') {
        line.pop();
    }
    Ok(Some(String::from_utf8(line).unwrap_or_default()))
}

#[cfg(unix)]
fn bind_socket(path: &Path) -> io::Result<std::os::unix::net::UnixListener> {
    let listener = std::os::unix::net::UnixListener::bind(path)?;
    set_mode(path, OWNER_ONLY)?;
    Ok(listener)
}

fn write_secret(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(OWNER_ONLY);
    }
    let mut file = options.open(path)?;
    file.write_all(bytes)?;
    file.sync_all()?;
    #[cfg(unix)]
    set_mode(path, OWNER_ONLY)?;
    Ok(())
}

#[cfg(unix)]
fn set_mode(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

fn random_token() -> io::Result<String> {
    let mut bytes = [0u8; 32];
    File::open("/dev/urandom")?.read_exact(&mut bytes)?;
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut token = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        token.push(HEX[(byte >> 4) as usize] as char);
        token.push(HEX[(byte & 0xf) as usize] as char);
    }
    Ok(token)
}

#[cfg(all(test, unix))]
mod tests {
    use std::io::{Read, Write};
    use std::os::unix::fs::{symlink, PermissionsExt};
    use std::os::unix::net::UnixStream;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Mutex;
    use std::thread;
    use std::time::Instant;

    use super::*;

    fn scratch() -> PathBuf {
        static N: AtomicU64 = AtomicU64::new(0);
        let n = N.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!("pcmcp{}{n}", std::process::id()));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    fn connect(dir: &Path) -> UnixStream {
        UnixStream::connect(socket_path(dir)).unwrap()
    }

    fn stays_open(stream: &mut UnixStream) {
        stream
            .set_read_timeout(Some(Duration::from_millis(300)))
            .unwrap();
        let mut buf = [0u8; 8];
        match stream.read(&mut buf) {
            Ok(0) => panic!("connection closed"),
            Ok(n) => panic!("server wrote {n} bytes"),
            Err(error) => assert!(
                error.kind() == ErrorKind::TimedOut || error.kind() == ErrorKind::WouldBlock,
                "{error:?}"
            ),
        }
    }

    fn closed(stream: &mut UnixStream) {
        let _ = stream.set_read_timeout(Some(Duration::from_secs(2)));
        let mut buf = [0u8; 8];
        match stream.read(&mut buf) {
            Ok(0) => {}
            Ok(n) => panic!("server wrote {n} bytes"),
            Err(error) => panic!("expected EOF, got {error:?}"),
        }
    }

    #[test]
    fn the_line_must_be_the_whole_token() {
        assert!(accepted("abc", "abc"));
        assert!(!accepted("", "abc"));
        assert!(!accepted("ab", "abc"));
        assert!(!accepted("xyz", "abc"));
        assert!(!accepted("", ""));
    }

    #[test]
    fn a_matching_token_keeps_the_connection() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        let token = fs::read_to_string(token_path(&dir)).unwrap();

        let mut client = connect(&dir);
        write!(client, "{token}\n").unwrap();
        stays_open(&mut client);

        drop(client);
        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_wrong_token_closes_the_connection() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();

        let mut client = connect(&dir);
        write!(client, "not-the-token\n").unwrap();
        closed(&mut client);

        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn an_empty_token_closes_the_connection() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();

        let mut client = connect(&dir);
        write!(client, "\n").unwrap();
        closed(&mut client);

        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn the_token_and_the_socket_are_owner_only() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        assert_eq!(mode_of(&token_path(&dir)), OWNER_ONLY);
        assert_eq!(mode_of(&socket_path(&dir)), OWNER_ONLY);
        assert_eq!(mode_of(&version_path(&dir)), OWNER_ONLY);
        assert_eq!(
            fs::read_to_string(version_path(&dir)).unwrap().trim(),
            env!("CARGO_PKG_VERSION")
        );
        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn disabling_removes_the_socket_and_the_token() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        access.set_enabled(&dir, false).unwrap();
        assert!(!socket_path(&dir).exists());
        assert!(!token_path(&dir).exists());
        assert!(!version_path(&dir).exists());
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn disabling_closes_an_accepted_connection() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        let token = fs::read_to_string(token_path(&dir)).unwrap();

        let mut client = connect(&dir);
        write!(client, "{token}\n").unwrap();
        stays_open(&mut client);

        access.set_enabled(&dir, false).unwrap();
        closed(&mut client);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn disabling_finishes_after_the_socket_file_is_gone() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        fs::remove_file(socket_path(&dir)).unwrap();
        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_live_socket_is_left_to_the_other_instance() {
        let dir = scratch();
        let first = Access::default();
        first.set_enabled(&dir, true).unwrap();
        let token = fs::read_to_string(token_path(&dir)).unwrap();

        clear_stale_socket(&dir).unwrap();
        assert_eq!(fs::read_to_string(token_path(&dir)).unwrap(), token);
        assert!(socket_path(&dir).exists());
        assert!(version_path(&dir).exists());

        let second = Access::default();
        let error = second.set_enabled(&dir, true).unwrap_err();
        assert_eq!(error.to_string(), "other_instance");
        assert_eq!(fs::read_to_string(token_path(&dir)).unwrap(), token);

        let mut client = connect(&dir);
        write!(client, "{token}\n").unwrap();
        stays_open(&mut client);

        drop(client);
        first.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_stale_socket_and_token_are_removed() {
        let dir = scratch();
        fs::write(socket_path(&dir), b"leftover").unwrap();
        fs::write(token_path(&dir), b"old-token").unwrap();
        fs::write(version_path(&dir), b"0.0.0\n").unwrap();
        clear_stale_socket(&dir).unwrap();
        assert!(!socket_path(&dir).exists());
        assert!(!token_path(&dir).exists());
        assert!(!version_path(&dir).exists());

        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        assert!(socket_path(&dir).exists());
        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    struct RecordIo(Mutex<Vec<(u64, Vec<u8>)>>);

    impl SessionIo for RecordIo {
        fn bytes(&self, id: u64, data: &[u8]) {
            self.0.lock().expect("record").push((id, data.to_vec()));
        }

        fn close(&self, _id: u64) {}
    }

    #[test]
    fn bytes_after_the_token_are_forwarded_and_a_reply_is_written_back() {
        let dir = scratch();
        let record = Arc::new(RecordIo(Mutex::new(Vec::new())));
        let access = Access::default();
        access.set_enabled_with(&dir, true, record.clone()).unwrap();
        let token = fs::read_to_string(token_path(&dir)).unwrap();

        let mut client = connect(&dir);
        write!(client, "{token}\nhello").unwrap();

        let deadline = Instant::now() + Duration::from_secs(2);
        let mut session_id = None;
        while Instant::now() < deadline {
            let guard = record.0.lock().expect("record");
            if let Some((id, _)) = guard
                .iter()
                .find(|(_, data)| data.windows(5).any(|w| w == b"hello"))
            {
                session_id = Some(*id);
                break;
            }
            drop(guard);
            thread::sleep(Duration::from_millis(20));
        }
        let id = session_id.expect("forwarded bytes");
        access.write_session(id, b"pong").unwrap();

        client
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut buf = [0u8; 4];
        client.read_exact(&mut buf).unwrap();
        assert_eq!(&buf, b"pong");

        drop(client);
        access.set_enabled(&dir, false).unwrap();
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_write_the_client_does_not_read_times_out_and_shutdown_returns() {
        let dir = scratch();
        let access = Access::default();
        access.set_enabled(&dir, true).unwrap();
        let token = fs::read_to_string(token_path(&dir)).unwrap();
        let mut client = connect(&dir);
        write!(client, "{token}\n").unwrap();

        let ready = Instant::now() + Duration::from_secs(2);
        loop {
            match access.write_session(0, b"x") {
                Ok(()) => break,
                Err(error) if error.kind() == ErrorKind::NotFound && Instant::now() < ready => {
                    thread::sleep(Duration::from_millis(20));
                }
                Err(error) => panic!("session did not accept a small write: {error}"),
            }
        }

        let started = Instant::now();
        let error = access
            .write_session(0, &vec![b'y'; 8 * 1024 * 1024])
            .expect_err("a full socket should time out");
        let waited = started.elapsed();
        assert!(
            waited < WRITE_TIMEOUT + Duration::from_secs(2),
            "write did not return on the timeout: {waited:?} {error}"
        );
        assert!(
            waited >= WRITE_TIMEOUT - Duration::from_millis(500),
            "write returned before the timeout: {waited:?} {error}"
        );

        let started = Instant::now();
        access.set_enabled(&dir, false).unwrap();
        assert!(
            started.elapsed() < Duration::from_secs(2),
            "shutdown hung after a timed-out write"
        );
        drop(client);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn canonicalize_resolves_a_symlink_and_rejects_a_missing_path() {
        let dir = scratch();
        let file = dir.join("file");
        fs::write(&file, b"x").unwrap();
        let link = dir.join("link");
        symlink(&file, &link).unwrap();

        let resolved = canonicalize_path(&link).unwrap();
        assert_eq!(resolved, fs::canonicalize(&file).unwrap());
        assert!(canonicalize_path(&dir.join("missing")).is_err());
        let _ = fs::remove_dir_all(&dir);
    }
}

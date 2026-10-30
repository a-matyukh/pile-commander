//! The `mcp` process: the same byte pipe as `apps/mcp`, inside this binary.
//!
//! It does not parse MCP and it does not open a window. The first line on the
//! socket is the access token. After that, stdin and the socket are copied
//! onto each other. Messages of our own go to stderr only.

use std::fs;
use std::io::{self, ErrorKind, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;

#[cfg(unix)]
use std::os::unix::net::UnixStream;

const OFF: &str = "Pile Commander is not running or agent access is off\n";
const VERSION_MISMATCH: &str =
    "Pile Commander is running a different version than this program\n";

/// App data directory the dev pipe also uses. Computed here so `mcp` can run
/// before `tauri::Builder`.
pub fn app_data_dir() -> PathBuf {
    let home = std::env::var_os("HOME").unwrap_or_default();
    PathBuf::from(home).join("Library/Application Support/com.pile.commander")
}

pub fn mcp_pipe_main() -> i32 {
    run_mcp_pipe(
        &app_data_dir(),
        env!("CARGO_PKG_VERSION"),
        io::stdin(),
        io::stdout(),
        io::stderr(),
    )
}

/// Copies stdio onto the running app's socket. Returns the process exit code.
pub fn run_mcp_pipe<R, O, E>(dir: &Path, own_version: &str, stdin: R, stdout: O, stderr: E) -> i32
where
    R: Read + Send + 'static,
    O: Write,
    E: Write,
{
    #[cfg(unix)]
    {
        run_unix(dir, own_version, stdin, stdout, stderr)
    }
    #[cfg(not(unix))]
    {
        let _ = (dir, own_version, stdin, stdout);
        refuse(stderr, OFF)
    }
}

#[cfg(unix)]
fn run_unix<R, O, E>(dir: &Path, own_version: &str, stdin: R, mut stdout: O, mut stderr: E) -> i32
where
    R: Read + Send + 'static,
    O: Write,
    E: Write,
{
    let socket_path = dir.join("mcp.sock");
    let token_path = dir.join("mcp.token");
    let version_path = dir.join("mcp.version");
    if !socket_path.exists() || !token_path.exists() {
        return refuse(&mut stderr, OFF);
    }
    let version = match fs::read_to_string(&version_path) {
        Ok(text) => text,
        Err(_) => return refuse(&mut stderr, VERSION_MISMATCH),
    };
    if version.trim() != own_version.trim() {
        return refuse(&mut stderr, VERSION_MISMATCH);
    }
    let token = match fs::read_to_string(&token_path) {
        Ok(text) => text.trim_end_matches(['\r', '\n']).to_string(),
        Err(_) => return refuse(&mut stderr, OFF),
    };
    if token.is_empty() {
        return refuse(&mut stderr, OFF);
    }

    let mut stream = match UnixStream::connect(&socket_path) {
        Ok(stream) => stream,
        Err(_) => return refuse(&mut stderr, OFF),
    };
    if write_all(&mut stream, format!("{token}\n").as_bytes()).is_err() {
        return refuse(&mut stderr, OFF);
    }

    let mut outbound = match stream.try_clone() {
        Ok(stream) => stream,
        Err(_) => return refuse(&mut stderr, OFF),
    };
    let stdin_ended = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&stdin_ended);
    thread::spawn(move || copy_stdin(stdin, &mut outbound, &flag));

    let mut buf = [0u8; 8192];
    loop {
        match stream.read(&mut buf) {
            Ok(0) => {
                return if stdin_ended.load(Ordering::SeqCst) {
                    0
                } else {
                    refuse(&mut stderr, OFF)
                };
            }
            Ok(n) => {
                if stdout.write_all(&buf[..n]).is_err() {
                    return refuse(&mut stderr, OFF);
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => {
                return if stdin_ended.load(Ordering::SeqCst) {
                    0
                } else {
                    refuse(&mut stderr, OFF)
                };
            }
        }
    }
}

#[cfg(unix)]
fn copy_stdin(mut stdin: impl Read, outbound: &mut UnixStream, stdin_ended: &AtomicBool) {
    let mut buf = [0u8; 8192];
    loop {
        match stdin.read(&mut buf) {
            Ok(0) => {
                stdin_ended.store(true, Ordering::SeqCst);
                let _ = outbound.shutdown(std::net::Shutdown::Write);
                break;
            }
            Ok(n) => {
                if write_all(outbound, &buf[..n]).is_err() {
                    break;
                }
            }
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        }
    }
}

fn write_all(target: &mut impl Write, bytes: &[u8]) -> io::Result<()> {
    target.write_all(bytes)?;
    target.flush()
}

fn refuse(mut stderr: impl Write, phrase: &str) -> i32 {
    let _ = stderr.write_all(phrase.as_bytes());
    1
}

#[cfg(all(test, unix))]
mod tests {
    use std::io::Read;
    use std::os::unix::net::{UnixListener, UnixStream};
    use std::time::Duration;

    use super::*;

    const PHRASE: &str = "Pile Commander is not running or agent access is off\n";
    const OTHER_VERSION: &str = "Pile Commander is running a different version than this program\n";

    fn scratch() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "pcpipe{}{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_different_version_refuses_without_connecting() {
        let dir = scratch();
        fs::write(dir.join("mcp.token"), b"secret-token").unwrap();
        fs::write(dir.join("mcp.version"), b"0.0.0\n").unwrap();
        let listener = UnixListener::bind(dir.join("mcp.sock")).unwrap();
        listener.set_nonblocking(true).unwrap();

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run_mcp_pipe(&dir, "9.9.9", io::empty(), &mut stdout, &mut stderr);

        assert_eq!(code, 1);
        assert!(stdout.is_empty());
        assert_eq!(String::from_utf8(stderr).unwrap(), OTHER_VERSION);
        match listener.accept() {
            Err(error) if error.kind() == ErrorKind::WouldBlock => {}
            other => panic!("the pipe connected: {other:?}"),
        }
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_missing_socket_exits_1_with_the_off_phrase() {
        let dir = scratch();
        fs::write(dir.join("mcp.token"), b"secret-token").unwrap();
        fs::write(dir.join("mcp.version"), b"9.9.9\n").unwrap();

        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        let code = run_mcp_pipe(&dir, "9.9.9", io::empty(), &mut stdout, &mut stderr);

        assert_eq!(code, 1);
        assert!(stdout.is_empty());
        assert_eq!(String::from_utf8(stderr).unwrap(), PHRASE);
        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn stdout_is_only_the_bytes_from_the_socket() {
        let dir = scratch();
        fs::write(dir.join("mcp.token"), b"secret-token").unwrap();
        fs::write(dir.join("mcp.version"), b"9.9.9\n").unwrap();
        let listener = UnixListener::bind(dir.join("mcp.sock")).unwrap();
        listener.set_nonblocking(true).unwrap();

        let (mut stdout_here, stdout_there) = UnixStream::pair().unwrap();
        let (mut stderr_here, stderr_there) = UnixStream::pair().unwrap();
        let pipe_dir = dir.clone();
        thread::spawn(move || {
            run_mcp_pipe(&pipe_dir, "9.9.9", io::empty(), stdout_there, stderr_there);
        });

        let started = std::time::Instant::now();
        let mut connection = loop {
            match listener.accept() {
                Ok((stream, _)) => break stream,
                Err(error) if error.kind() == ErrorKind::WouldBlock => {
                    if started.elapsed() > Duration::from_secs(3) {
                        panic!("the pipe did not connect");
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Err(error) => panic!("{error}"),
            }
        };
        connection
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut token = Vec::new();
        let mut byte = [0u8; 1];
        loop {
            connection.read_exact(&mut byte).unwrap();
            if byte[0] == b'\n' {
                break;
            }
            token.push(byte[0]);
        }
        assert_eq!(token, b"secret-token");
        connection.write_all(b"from-socket").unwrap();
        connection.flush().unwrap();

        stdout_here
            .set_read_timeout(Some(Duration::from_secs(3)))
            .unwrap();
        let mut got = Vec::new();
        let mut buf = [0u8; 64];
        loop {
            let n = stdout_here.read(&mut buf).unwrap();
            got.extend_from_slice(&buf[..n]);
            if got == b"from-socket" {
                break;
            }
        }
        assert_eq!(got, b"from-socket");

        stderr_here
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();
        let mut err = [0u8; 8];
        match stderr_here.read(&mut err) {
            Err(error) if error.kind() == ErrorKind::TimedOut || error.kind() == ErrorKind::WouldBlock => {}
            Ok(0) => {}
            other => panic!("stderr was not empty: {other:?}"),
        }
        drop(connection);
        let _ = fs::remove_dir_all(&dir);
    }
}

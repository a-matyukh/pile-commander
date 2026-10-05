//! Cross-platform extended file attributes:
//! xattr on Unix, NTFS Alternate Data Streams on Windows.

pub use imp::{get, list, remove, set};

/// On Unix, attributes are stored in the `user.` namespace - it is the only
/// one writable without privileges on Linux, and it matches the naming
/// scheme under which the plugin has already written attributes to
/// existing files.
#[cfg(unix)]
mod imp {
    use std::io;

    const PREFIX: &str = "user.";

    pub fn get(path: &str, name: &str) -> io::Result<Option<Vec<u8>>> {
        xattr::get_deref(path, format!("{PREFIX}{name}"))
    }

    pub fn set(path: &str, name: &str, value: &[u8]) -> io::Result<()> {
        xattr::set_deref(path, format!("{PREFIX}{name}"), value)
    }

    pub fn remove(path: &str, name: &str) -> io::Result<()> {
        xattr::remove_deref(path, format!("{PREFIX}{name}"))
    }

    pub fn list(path: &str) -> io::Result<Vec<String>> {
        Ok(xattr::list_deref(path)?
            .filter_map(|attr| {
                attr.to_string_lossy()
                    .strip_prefix(PREFIX)
                    .map(str::to_owned)
            })
            .collect())
    }
}

/// On Windows, each attribute is stored as a named stream `path:name`.
#[cfg(windows)]
mod imp {
    use std::ffi::OsString;
    use std::io::{self, ErrorKind, Read};
    use std::os::windows::ffi::{OsStrExt, OsStringExt};
    use std::path::Path;

    use windows_sys::Win32::Foundation::{ERROR_HANDLE_EOF, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::{
        FindClose, FindFirstStreamW, FindNextStreamW, FindStreamInfoStandard,
        WIN32_FIND_STREAM_DATA,
    };

    fn stream_path(path: &str, name: &str) -> String {
        format!("{path}:{name}")
    }

    pub fn get(path: &str, name: &str) -> io::Result<Option<Vec<u8>>> {
        match std::fs::File::open(stream_path(path, name)) {
            Ok(mut file) => {
                let mut value = Vec::new();
                file.read_to_end(&mut value)?;
                Ok(Some(value))
            }
            // The stream is missing: report "no attribute" only when the
            // file itself exists, otherwise propagate NotFound.
            Err(e) if e.kind() == ErrorKind::NotFound && Path::new(path).exists() => Ok(None),
            Err(e) => Err(e),
        }
    }

    pub fn set(path: &str, name: &str, value: &[u8]) -> io::Result<()> {
        // Writing to a stream of a non-existent file would silently create
        // the file itself.
        if !Path::new(path).exists() {
            return Err(io::Error::new(ErrorKind::NotFound, "no such file"));
        }
        std::fs::write(stream_path(path, name), value)
    }

    pub fn remove(path: &str, name: &str) -> io::Result<()> {
        if !Path::new(path).exists() {
            return Err(io::Error::new(ErrorKind::NotFound, "no such file"));
        }
        std::fs::remove_file(stream_path(path, name))
    }

    pub fn list(path: &str) -> io::Result<Vec<String>> {
        let wide: Vec<u16> = Path::new(path)
            .as_os_str()
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        let mut data: WIN32_FIND_STREAM_DATA = unsafe { std::mem::zeroed() };
        let handle = unsafe {
            FindFirstStreamW(
                wide.as_ptr(),
                FindStreamInfoStandard,
                &mut data as *mut _ as *mut _,
                0,
            )
        };
        if handle == INVALID_HANDLE_VALUE {
            let err = io::Error::last_os_error();
            // A directory without attributes has no streams at all;
            // that is not an error.
            return if err.raw_os_error() == Some(ERROR_HANDLE_EOF as i32)
                && Path::new(path).exists()
            {
                Ok(Vec::new())
            } else {
                Err(err)
            };
        }

        let mut names = Vec::new();
        loop {
            if let Some(name) = attr_name(&data.cStreamName) {
                names.push(name);
            }
            if unsafe { FindNextStreamW(handle, &mut data as *mut _ as *mut _) } == 0 {
                let err = io::Error::last_os_error();
                unsafe { FindClose(handle) };
                return if err.raw_os_error() == Some(ERROR_HANDLE_EOF as i32) {
                    Ok(names)
                } else {
                    Err(err)
                };
            }
        }
    }

    /// Stream names come in the form `:name:$DATA`; the unnamed stream
    /// (`::$DATA`) is the file contents itself, not an attribute.
    fn attr_name(raw: &[u16]) -> Option<String> {
        let len = raw.iter().position(|&c| c == 0).unwrap_or(raw.len());
        let full = OsString::from_wide(&raw[..len])
            .to_string_lossy()
            .into_owned();
        let name = full.strip_prefix(':')?.strip_suffix(":$DATA")?;
        (!name.is_empty()).then(|| name.to_owned())
    }
}

//! Where this crate's own commands may read and write.
//!
//! plugin-fs is fenced by the capability files. The commands here are not:
//! they run as the app, so each one asks this module first. The rules match
//! the capability files (`capabilities/home-writes-*.json`):
//!
//! - **readable**: inside the fs scope — the home folder, and whatever the
//!   person picked in a system dialog, dropped on the window or opened with
//!   the app.
//! - **writable**: readable, and not a protected place of the home folder:
//!   `Library` (macOS), `AppData` and the PowerShell profile folders
//!   (Windows), and every dot entry at the top of home except `.pile` —
//!   shell profiles, `.ssh`, `.config`. A script that got into the window
//!   must not be able to plant something that runs at the next login.
//!
//! Symlinks are resolved as far as the path exists, so a link inside home
//! does not lead a write out of it.

use std::ffi::OsString;
use std::io::{self, ErrorKind};
use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_fs::FsExt;

/// Start of the refusal for a protected place. The client shows its own
/// sentence for it (`is_protected_path_error` in the file-manager package).
pub const PROTECTED: &str = "protected folder";

const PILE_DIR: &str = ".pile";

fn invalid(message: &str) -> io::Error {
    io::Error::new(ErrorKind::InvalidInput, message.to_string())
}

/// The path with its symlinks resolved as far as it exists; the part that
/// does not exist yet is kept as written. `..` and relative paths are
/// refused, and so is a link that points nowhere: writing through it would
/// create its target.
pub fn resolve(path: &Path) -> io::Result<PathBuf> {
    if !path.is_absolute() {
        return Err(invalid("the path is not absolute"));
    }
    if path
        .components()
        .any(|part| matches!(part, Component::ParentDir))
    {
        return Err(invalid("the path contains \"..\""));
    }
    let mut existing = path.to_path_buf();
    let mut missing: Vec<OsString> = Vec::new();
    loop {
        match std::fs::canonicalize(&existing) {
            Ok(mut resolved) => {
                resolved.extend(missing.iter().rev());
                return Ok(resolved);
            }
            Err(error) if error.kind() == ErrorKind::NotFound => {
                if existing.symlink_metadata().is_ok() {
                    return Err(invalid("the path goes through a broken link"));
                }
                let Some(name) = existing.file_name().map(OsString::from) else {
                    return Err(error);
                };
                missing.push(name);
                if !existing.pop() {
                    return Err(error);
                }
            }
            Err(error) => return Err(error),
        }
    }
}

/// As `resolve`, but the last name is kept as written: for a command that
/// acts on the entry itself (the Trash takes a link, not what it points to).
pub fn resolve_entry(path: &Path) -> io::Result<PathBuf> {
    let (Some(parent), Some(name)) = (path.parent(), path.file_name()) else {
        return resolve(path);
    };
    if !path.is_absolute() {
        return Err(invalid("the path is not absolute"));
    }
    Ok(resolve(parent)?.join(name))
}

fn lower(name: &std::ffi::OsStr) -> String {
    name.to_string_lossy().to_lowercase()
}

/// Names under `base`, lowercased, when `path` is inside it. Case is folded
/// because the default macOS and Windows file systems ignore it.
fn names_under(base: &Path, path: &Path) -> Option<Vec<String>> {
    let rest = path.strip_prefix(base).ok()?;
    Some(
        rest.components()
            .filter_map(|part| match part {
                Component::Normal(name) => Some(lower(name)),
                _ => None,
            })
            .collect(),
    )
}

/// A place in the home folder the app never writes to. `home`, `documents`
/// and `path` are resolved paths.
pub fn is_protected(home: &Path, documents: Option<&Path>, path: &Path) -> bool {
    if let Some(names) = names_under(home, path) {
        if let Some(first) = names.first() {
            if first.starts_with('.') && first != PILE_DIR {
                return true;
            }
            if cfg!(target_os = "macos") && first == "library" {
                return true;
            }
            if cfg!(windows) && first == "appdata" {
                return true;
            }
        }
    }
    if cfg!(windows) {
        if let Some(names) = documents.and_then(|documents| names_under(documents, path)) {
            if matches!(
                names.first().map(String::as_str),
                Some("powershell" | "windowspowershell")
            ) {
                return true;
            }
        }
    }
    false
}

fn resolved_dir(dir: tauri::Result<PathBuf>) -> Option<PathBuf> {
    let dir = dir.ok()?;
    Some(std::fs::canonicalize(&dir).unwrap_or(dir))
}

fn refused(error: io::Error) -> String {
    error.to_string()
}

fn in_scope<R: Runtime>(app: &AppHandle<R>, path: &str, resolved: PathBuf) -> Result<PathBuf, String> {
    if app.fs_scope().is_allowed(&resolved) {
        Ok(resolved)
    } else {
        Err(format!(
            "“{path}” is outside the folders Pile Commander may use"
        ))
    }
}

fn unprotected<R: Runtime>(app: &AppHandle<R>, path: &str, resolved: PathBuf) -> Result<PathBuf, String> {
    let home = resolved_dir(app.path().home_dir());
    let documents = resolved_dir(app.path().document_dir());
    match home {
        Some(home) if is_protected(&home, documents.as_deref(), &resolved) => Err(format!(
            "{PROTECTED}: Pile Commander does not change “{path}”"
        )),
        _ => Ok(resolved),
    }
}

/// A path the app may read: resolved, and inside the fs scope.
pub fn readable<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let resolved = resolve(Path::new(path)).map_err(refused)?;
    in_scope(app, path, resolved)
}

/// A path the app may create, change or remove.
pub fn writable<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let resolved = readable(app, path)?;
    unprotected(app, path, resolved)
}

/// An entry the app may move or remove as it is: its folder is resolved, its
/// own name is not followed if it is a link.
pub fn writable_entry<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<PathBuf, String> {
    let resolved = resolve_entry(Path::new(path)).map_err(refused)?;
    let resolved = in_scope(app, path, resolved)?;
    unprotected(app, path, resolved)
}

/// A file or folder the system handed to the app (Open With, the Dock): the
/// person chose it, the same as a drop on the window, which plugin-fs adds
/// to its scope itself.
pub fn grant_opened<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    let scope = app.fs_scope();
    let granted = if path.is_dir() {
        scope.allow_directory(path, true)
    } else {
        scope.allow_file(path)
    };
    if let Err(error) = granted {
        log::warn!("opened path scope: {error}");
    }
}

/// Folders outside home the person gave the app — dropped on the window or
/// opened with it — one path per entry, newest last, in the app's config
/// directory (the window cannot write there). The fs scope lives in memory,
/// so without this list such a folder would open again after a restart
/// (the explorer remembers where it was) and nothing in it could be read.
const GRANTED_FILE: &str = "granted-folders.json";
const GRANTED_LIMIT: usize = 200;

fn granted_file<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    Some(app.path().app_config_dir().ok()?.join(GRANTED_FILE))
}

fn read_granted(file: &Path) -> Vec<PathBuf> {
    std::fs::read(file)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default()
}

/// `list` with `folder` moved to the end, cut to the newest `GRANTED_LIMIT`.
fn with_granted(mut list: Vec<PathBuf>, folder: &Path) -> Vec<PathBuf> {
    list.retain(|known| known != folder);
    list.push(folder.to_path_buf());
    let extra = list.len().saturating_sub(GRANTED_LIMIT);
    list.drain(..extra);
    list
}

/// Remembers a folder the person dropped or opened, when it is outside home
/// (home is always in scope).
pub fn remember_granted<R: Runtime>(app: &AppHandle<R>, path: &Path) {
    let Ok(folder) = std::fs::canonicalize(path) else {
        return;
    };
    if !folder.is_dir() {
        return;
    }
    if resolved_dir(app.path().home_dir()).is_some_and(|home| folder.starts_with(home)) {
        return;
    }
    let Some(file) = granted_file(app) else {
        return;
    };
    let list = with_granted(read_granted(&file), &folder);
    let written = file
        .parent()
        .map_or(Ok(()), std::fs::create_dir_all)
        .and_then(|()| Ok(serde_json::to_vec_pretty(&list)?))
        .and_then(|bytes| std::fs::write(&file, bytes));
    if let Err(error) = written {
        log::warn!("granted folders: {error}");
    }
}

/// Puts the remembered folders back into the fs scope at launch. One that
/// is gone (an unplugged disk) is skipped and stays on the list.
pub fn restore_granted<R: Runtime>(app: &AppHandle<R>) {
    let Some(file) = granted_file(app) else {
        return;
    };
    let scope = app.fs_scope();
    for folder in read_granted(&file) {
        if folder.is_absolute() && folder.is_dir() {
            if let Err(error) = scope.allow_directory(&folder, true) {
                log::warn!("granted folder scope: {error}");
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("pile-paths-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::canonicalize(&dir).unwrap()
    }

    #[test]
    fn a_missing_tail_is_kept_after_the_resolved_part() {
        let dir = scratch("tail");
        let resolved = resolve(&dir.join("new").join("file.txt")).unwrap();
        assert_eq!(resolved, dir.join("new").join("file.txt"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn parent_steps_and_relative_paths_are_refused() {
        let dir = scratch("dots");
        assert!(resolve(&dir.join("a").join("..").join("b")).is_err());
        assert!(resolve(Path::new("notes/a.txt")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_is_followed_to_where_it_really_goes() {
        let dir = scratch("link");
        let target = dir.join("Library");
        std::fs::create_dir_all(&target).unwrap();
        std::os::unix::fs::symlink(&target, dir.join("shortcut")).unwrap();

        let resolved = resolve(&dir.join("shortcut").join("LaunchAgents").join("x.plist")).unwrap();
        assert_eq!(resolved, target.join("LaunchAgents").join("x.plist"));
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn a_link_to_nowhere_is_refused() {
        let dir = scratch("broken");
        std::os::unix::fs::symlink(dir.join("gone"), dir.join("dangling")).unwrap();
        assert!(resolve(&dir.join("dangling")).is_err());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn an_entry_keeps_its_own_name_when_it_is_a_link() {
        let dir = scratch("entry");
        let outside = dir.join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        let folder = dir.join("folder");
        std::fs::create_dir_all(&folder).unwrap();
        std::os::unix::fs::symlink(&outside, folder.join("shortcut")).unwrap();
        std::os::unix::fs::symlink(dir.join("gone"), folder.join("dangling")).unwrap();

        // the link itself, in the folder it sits in
        assert_eq!(resolve_entry(&folder.join("shortcut")).unwrap(), folder.join("shortcut"));
        assert_eq!(resolve_entry(&folder.join("dangling")).unwrap(), folder.join("dangling"));
        // while the plain rule follows it
        assert_eq!(resolve(&folder.join("shortcut")).unwrap(), outside);
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_granted_folder_is_listed_once_newest_last() {
        let a = PathBuf::from("/Volumes/Stick/Trip");
        let b = PathBuf::from("/Volumes/Stick/Work");
        let list = with_granted(with_granted(with_granted(Vec::new(), &a), &b), &a);
        assert_eq!(list, vec![b.clone(), a.clone()]);

        let many = (0..GRANTED_LIMIT + 5).fold(Vec::new(), |list, index| {
            with_granted(list, Path::new(&format!("/Volumes/Stick/{index}")))
        });
        assert_eq!(many.len(), GRANTED_LIMIT);
        assert_eq!(many.first().unwrap(), Path::new("/Volumes/Stick/5"));
    }

    #[test]
    fn a_damaged_granted_list_reads_as_empty() {
        let dir = scratch("granted");
        let file = dir.join(GRANTED_FILE);
        std::fs::write(&file, b"[not json").unwrap();
        assert!(read_granted(&file).is_empty());
        assert!(read_granted(&dir.join("missing.json")).is_empty());
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn dot_entries_at_the_top_of_home_are_protected_except_pile() {
        let home = Path::new("/Users/ann");
        let protected = |path: &str| is_protected(home, None, Path::new(path));

        assert!(protected("/Users/ann/.zshrc"));
        assert!(protected("/Users/ann/.ssh/authorized_keys"));
        assert!(protected("/Users/ann/.config/fish/config.fish"));
        assert!(protected("/Users/ann/.pilex"));
        assert!(protected("/Users/ann/.pil"));

        assert!(!protected("/Users/ann/.pile/strokes.json"));
        assert!(!protected("/Users/ann/.PILE/strokes.json"));
        assert!(!protected("/Users/ann/Documents/notes.txt"));
        assert!(!protected("/Users/ann/Projects/site/.git/config"));
        assert!(!protected("/Users/ann/Documents/.pile/sync.json"));
        assert!(!protected("/Users/ann"));
        assert!(!protected("/Volumes/Stick/.hidden"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn library_is_protected_in_any_letter_case() {
        let home = Path::new("/Users/ann");
        let protected = |path: &str| is_protected(home, None, Path::new(path));

        assert!(protected("/Users/ann/Library"));
        assert!(protected("/Users/ann/Library/LaunchAgents/evil.plist"));
        assert!(protected("/Users/ann/library/LaunchAgents/evil.plist"));
        assert!(protected("/Users/ann/LIBRARY/Caches/x"));
        assert!(!protected("/Users/ann/Library books/list.txt"));
        assert!(!protected("/Users/ann/Documents/Library/list.txt"));
    }
}

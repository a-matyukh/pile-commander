//! The mark macOS puts on a downloaded file (`com.apple.quarantine`). A
//! synced folder brings files other people put into its cloud copy, and
//! without the mark a program among them would start from Finder with no
//! question from Gatekeeper, the way no browser download does. Documents,
//! pictures and notes open as before: the system asks only about what runs.

use tauri::AppHandle;

use crate::paths;

/// Marks a file the app has just written from the cloud. Nothing to do
/// outside macOS, and nothing for a folder.
#[tauri::command]
pub fn mark_downloaded(app: AppHandle, path: String) -> Result<(), String> {
    // the entry itself: a link is not followed to whatever it points at
    let resolved = paths::writable_entry(&app, &path)?;
    mark(&resolved)
}

#[cfg(target_os = "macos")]
const QUARANTINE: &str = "com.apple.quarantine";

/// `flags;time;agent;id`, the form the system and every browser write.
/// 0081: downloaded, and nobody has approved opening it yet.
#[cfg(target_os = "macos")]
fn value(seconds: u64) -> String {
    format!("0081;{seconds:08x};Pile Commander;")
}

#[cfg(target_os = "macos")]
fn mark(path: &std::path::Path) -> Result<(), String> {
    let is_file = path
        .symlink_metadata()
        .map_err(|error| error.to_string())?
        .is_file();
    if !is_file {
        return Ok(());
    }
    // A mark that is already there stays: it may record that the person
    // has approved this very file.
    if xattr::get(path, QUARANTINE)
        .map_err(|error| error.to_string())?
        .is_some()
    {
        return Ok(());
    }
    let seconds = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|since| since.as_secs())
        .unwrap_or(0);
    xattr::set(path, QUARANTINE, value(seconds).as_bytes()).map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
fn mark(_path: &std::path::Path) -> Result<(), String> {
    Ok(())
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("pile-quarantine-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_written_file_gets_the_mark_and_keeps_it_through_a_rename() {
        let dir = scratch("file");
        let temporary = dir.join("sync-1.tmp");
        std::fs::write(&temporary, b"#!/bin/sh\n").unwrap();
        mark(&temporary).unwrap();
        let target = dir.join("run.command");
        std::fs::rename(&temporary, &target).unwrap();
        let stored = String::from_utf8(xattr::get(&target, QUARANTINE).unwrap().unwrap()).unwrap();
        let parts: Vec<&str> = stored.split(';').collect();
        assert_eq!(parts[0], "0081");
        assert!(u64::from_str_radix(parts[1], 16).unwrap() > 1_700_000_000);
        assert_eq!(parts[2], "Pile Commander");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn a_mark_that_is_there_is_left_as_it_is_and_a_folder_gets_none() {
        let dir = scratch("kept");
        let file = dir.join("approved.app.zip");
        std::fs::write(&file, b"x").unwrap();
        xattr::set(&file, QUARANTINE, b"00c1;6561f0a0;Safari;").unwrap();
        mark(&file).unwrap();
        assert_eq!(xattr::get(&file, QUARANTINE).unwrap().unwrap(), b"00c1;6561f0a0;Safari;");
        mark(&dir).unwrap();
        assert!(xattr::get(&dir, QUARANTINE).unwrap().is_none());
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

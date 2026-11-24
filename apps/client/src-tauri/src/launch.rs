//! Opening a file with its default app.
//!
//! The window cannot do it itself (no `opener:allow-open-path`): a script
//! that got into it could write a program into a folder and open it. The
//! window asks this command instead, and for a file the system would run,
//! install or mount the person confirms in a system dialog the page cannot
//! draw over or click.

use std::path::Path;

use tauri::{AppHandle, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::paths;

/// Extensions the system runs, installs or mounts on open, lowercase.
#[cfg(target_os = "macos")]
const RUNS_ON_OPEN: &[&str] = &[
    "action",
    "app",
    "applescript",
    "bash",
    "bundle",
    "command",
    "csh",
    "dmg",
    "fileloc",
    "fish",
    "inetloc",
    "jar",
    "jxa",
    "kext",
    "ksh",
    "mobileconfig",
    "mpkg",
    "osax",
    "pkg",
    "pl",
    "plugin",
    "prefpane",
    "py",
    "qlgenerator",
    "rb",
    "saver",
    "scpt",
    "scptd",
    "sh",
    "shortcut",
    "terminal",
    "tool",
    "workflow",
    "zsh",
];

#[cfg(windows)]
const RUNS_ON_OPEN: &[&str] = &[
    "appinstaller",
    "application",
    "appref-ms",
    "appx",
    "bat",
    "chm",
    "cmd",
    "com",
    "cpl",
    "diagcab",
    "exe",
    "gadget",
    "hta",
    "inf",
    "jar",
    "js",
    "jse",
    "library-ms",
    "lnk",
    "msc",
    "msi",
    "msix",
    "msp",
    "mst",
    "pif",
    "ps1",
    "psc1",
    "py",
    "pyw",
    "reg",
    "scf",
    "scr",
    "settingcontent-ms",
    "url",
    "vbe",
    "vbs",
    "website",
    "wsf",
    "wsh",
];

#[cfg(all(unix, not(target_os = "macos")))]
const RUNS_ON_OPEN: &[&str] = &[
    "appimage",
    "bash",
    "deb",
    "desktop",
    "flatpakref",
    "jar",
    "pl",
    "py",
    "rb",
    "rpm",
    "run",
    "sh",
    "snap",
];

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .map(|extension| extension.to_string_lossy().to_lowercase())
}

/// A file marked executable. With an extension the system picks the app by
/// the extension (a photo off a camera card is often marked executable and
/// still opens as a photo); without one it runs the file in a terminal.
#[cfg(unix)]
fn is_bare_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    path.extension().is_none()
        && std::fs::metadata(path)
            .is_ok_and(|info| info.is_file() && info.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn is_bare_executable(_path: &Path) -> bool {
    false
}

/// Opening this would run a program, install something or mount a disk.
pub fn runs_on_open(path: &Path) -> bool {
    extension(path).is_some_and(|extension| RUNS_ON_OPEN.contains(&extension.as_str()))
        || is_bare_executable(path)
}

struct Wording {
    title: &'static str,
    open: &'static str,
    cancel: &'static str,
}

fn wording(lang: Option<&str>) -> Wording {
    if lang.is_some_and(|lang| lang.starts_with("ru")) {
        Wording {
            title: "Открыть файл?",
            open: "Открыть",
            cancel: "Отмена",
        }
    } else {
        Wording {
            title: "Open this file?",
            open: "Open",
            cancel: "Cancel",
        }
    }
}

fn question(lang: Option<&str>, name: &str) -> String {
    if lang.is_some_and(|lang| lang.starts_with("ru")) {
        format!("«{name}» может запускать программы на этом компьютере. Открывайте, только если знаете, откуда этот файл.")
    } else {
        format!("“{name}” can run programs on this computer. Open it only if you know where it came from.")
    }
}

/// Opens a file or folder with its default app. A file that runs on open
/// waits for the person's yes; a no opens nothing and is not an error.
#[tauri::command]
pub async fn open_path<R: Runtime>(
    app: AppHandle<R>,
    path: String,
    lang: Option<String>,
) -> Result<(), String> {
    let resolved = paths::readable(&app, &path)?;
    if runs_on_open(&resolved) {
        let name = resolved
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| path.clone());
        let words = wording(lang.as_deref());
        let dialog = app
            .dialog()
            .message(question(lang.as_deref(), &name))
            .title(words.title)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                words.open.to_string(),
                words.cancel.to_string(),
            ));
        let confirmed = tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
            .await
            .map_err(|error| error.to_string())?;
        if !confirmed {
            return Ok(());
        }
    }
    app.opener()
        .open_path(resolved.to_string_lossy(), None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_extension_decides_in_any_letter_case() {
        #[cfg(target_os = "macos")]
        {
            assert!(runs_on_open(Path::new("/Users/ann/Desktop/Fix.command")));
            assert!(runs_on_open(Path::new("/Users/ann/Desktop/Game.APP")));
            assert!(runs_on_open(Path::new("/Users/ann/Downloads/setup.pkg")));
        }
        #[cfg(windows)]
        {
            assert!(runs_on_open(Path::new("C:\\Users\\ann\\Desktop\\setup.EXE")));
            assert!(runs_on_open(Path::new("C:\\Users\\ann\\Desktop\\run.bat")));
        }
        assert!(!runs_on_open(Path::new("/Users/ann/Desktop/photo.jpg")));
        assert!(!runs_on_open(Path::new("/Users/ann/Desktop/notes.txt")));
        assert!(!runs_on_open(Path::new("/Users/ann/Desktop/Folder")));
    }

    #[cfg(unix)]
    #[test]
    fn an_executable_file_without_an_extension_runs_and_a_marked_photo_does_not() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("pile-launch-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let executable = std::fs::Permissions::from_mode(0o755);

        let tool = dir.join("tool");
        std::fs::write(&tool, "#!/bin/sh\n").unwrap();
        std::fs::set_permissions(&tool, executable.clone()).unwrap();
        let photo = dir.join("photo.jpg");
        std::fs::write(&photo, "jpeg").unwrap();
        std::fs::set_permissions(&photo, executable).unwrap();
        let readme = dir.join("README");
        std::fs::write(&readme, "text").unwrap();

        assert!(runs_on_open(&tool));
        assert!(!runs_on_open(&photo));
        assert!(!runs_on_open(&readme));
        // a folder is listed, not run, whatever its mode says
        assert!(!runs_on_open(&dir));
        std::fs::remove_dir_all(&dir).unwrap();
    }
}

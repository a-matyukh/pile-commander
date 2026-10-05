use std::fs;
use std::io::{ErrorKind, Result as IoResult};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

mod presigned_put;
mod workspace_pack;

struct OpenedPaths(Mutex<Vec<String>>);

#[tauri::command]
fn take_opened_paths(app: AppHandle) -> Vec<String> {
    app.state::<OpenedPaths>()
        .0
        .lock()
        .unwrap()
        .drain(..)
        .collect()
}

fn ensure_directory_path(path: &str) -> IoResult<()> {
    let metadata = fs::metadata(path)?;
    if metadata.is_dir() {
        Ok(())
    } else {
        Err(std::io::Error::new(
            ErrorKind::InvalidInput,
            "path is not a directory",
        ))
    }
}

#[tauri::command]
fn ensure_directory(path: String) -> Result<(), String> {
    ensure_directory_path(&path).map_err(|e| e.to_string())
}

/// Moves a path to the OS trash — the reversible delete used by desktop
/// boards (plugin-fs `remove` is permanent).
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    trash::delete(&path).map_err(|e| e.to_string())
}

/// Returns `"directory"`, `"file"`, or `"other"` for an existing path.
#[tauri::command]
fn path_kind(path: String) -> Result<&'static str, String> {
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if metadata.is_dir() {
        Ok("directory")
    } else if metadata.is_file() {
        Ok("file")
    } else {
        Ok("other")
    }
}

#[cfg(target_os = "macos")]
fn handle_opened_paths(app: &AppHandle, paths: Vec<String>) {
    if paths.is_empty() {
        return;
    }

    if app.webview_windows().is_empty() {
        app.state::<OpenedPaths>().0.lock().unwrap().extend(paths);
        return;
    }

    let target_label: Option<String> = {
        let windows = app.webview_windows();
        windows
            .iter()
            .find(|(_, w)| w.is_focused().unwrap_or(false))
            .map(|(label, _)| label.clone())
            .or_else(|| windows.keys().next().cloned())
    };

    if let Some(label) = target_label {
        if let Some(window) = app.get_webview_window(&label) {
            let _ = window.show();
            let _ = window.set_focus();
            let _ = window.emit("opened-paths", paths);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedPaths(Mutex::new(vec![])))
        .manage(presigned_put::Uploads::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_xattrs::init())
        .invoke_handler(tauri::generate_handler![
            take_opened_paths,
            ensure_directory,
            path_kind,
            trash_path,
            workspace_pack::export_workspace_zip,
            workspace_pack::import_workspace_zip,
            presigned_put::put_presigned_start,
            presigned_put::put_presigned_chunk,
            presigned_put::put_presigned_finish,
            presigned_put::put_presigned_abort,
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_process::init())?;
            }
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Opened { urls } = event {
                let paths = urls
                    .into_iter()
                    .filter_map(|url| url.to_file_path().ok())
                    .map(|path| path.to_string_lossy().into_owned())
                    .collect();
                handle_opened_paths(app, paths);
            }
        });
}

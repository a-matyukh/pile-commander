use std::fs;
use std::io::{ErrorKind, Result as IoResult};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

mod ai;
mod mcp_access;
mod mcp_pipe;
mod presigned_put;
mod workspace_pack;

pub use mcp_pipe::mcp_pipe_main;

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

/// Absolute path of this process. The release MCP config copies it at runtime.
#[tauri::command]
fn mcp_current_exe() -> Result<String, String> {
    std::env::current_exe()
        .map(|path| path.to_string_lossy().into_owned())
        .map_err(|error| error.to_string())
}

/// Moves a path to the OS trash — the reversible delete used by desktop
/// boards (plugin-fs `remove` is permanent).
#[tauri::command]
fn trash_path(path: String) -> Result<(), String> {
    let mut ctx = trash::TrashContext::new();
    // Finder's AppleScript path asks to control Finder. The system call
    // moves the item into the Trash without that prompt.
    #[cfg(target_os = "macos")]
    {
        use trash::macos::{DeleteMethod, TrashContextExtMacos};
        ctx.set_delete_method(DeleteMethod::NsFileManager);
    }
    ctx.delete(&path).map_err(|e| e.to_string())
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

/// wry disables WKWebView bounce on iOS only. On macOS the web view's
/// NSScrollView (a WKScrollView subclass) still rubber-bands, and the system
/// background shows above and below the interface. `isKindOfClass` matches
/// that subclass.
#[cfg(target_os = "macos")]
fn pin_scroll_views(view: &objc2_app_kit::NSView) {
    use objc2::runtime::AnyObject;
    use objc2_app_kit::{NSScrollElasticity, NSScrollView};

    let object: &AnyObject = view;
    if let Some(scroll) = object.downcast_ref::<NSScrollView>() {
        scroll.setHorizontalScrollElasticity(NSScrollElasticity::None);
        scroll.setVerticalScrollElasticity(NSScrollElasticity::None);
    }
    let subviews = view.subviews();
    for index in 0..subviews.count() {
        pin_scroll_views(&subviews.objectAtIndex(index));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(OpenedPaths(Mutex::new(vec![])))
        .manage(presigned_put::Uploads::default())
        .manage(ai::Ai::default())
        .manage(mcp_access::Access::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
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
            ai::ai_key_set,
            ai::ai_key_delete,
            ai::ai_key_status,
            ai::ai_list_models,
            ai::ai_chat_stream,
            ai::ai_cancel,
            mcp_current_exe,
            mcp_access::mcp_set_access,
            mcp_access::mcp_session_write,
            mcp_access::mcp_realpath,
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
            // A crashed run leaves the socket and the token. A socket another
            // process is still accepting is left alone, together with its token.
            if let Ok(dir) = app.path().app_data_dir() {
                if let Err(error) = mcp_access::clear_stale_socket(&dir) {
                    log::warn!("mcp stale socket: {error}");
                }
            }
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("main") {
                if let Err(error) = window.with_webview(|webview| {
                    // SAFETY: `inner` is the live WKWebView, an NSView, for this call.
                    let view = unsafe { &*webview.inner().cast::<objc2_app_kit::NSView>() };
                    pin_scroll_views(view);
                }) {
                    log::warn!("webview overscroll: {error}");
                }
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app, event| {
            if matches!(event, tauri::RunEvent::Exit) {
                app.state::<mcp_access::Access>().shutdown();
            }
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

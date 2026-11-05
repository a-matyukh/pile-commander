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

/// Height of the overlay title bar, in physical pixels. The window-state
/// plugin stores `inner_size`, and `set_size` applies that as the content
/// rect, so an overlay title bar would grow the window on every launch.
/// Measured while the window is on screen and not fullscreen; a fullscreen
/// frame has no bar, and the saved file is left alone in that case.
#[cfg(target_os = "macos")]
struct OverlayTitleBar(Mutex<u32>);

#[cfg(target_os = "macos")]
fn remember_overlay_title_bar(app: &AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if window.is_fullscreen().unwrap_or(true) {
        return;
    }
    let Ok(inner) = window.inner_position() else {
        return;
    };
    let Ok(outer) = window.outer_position() else {
        return;
    };
    let bar = (inner.y - outer.y).max(0) as u32;
    if bar == 0 {
        return;
    }
    *app.state::<OverlayTitleBar>().0.lock().unwrap() = bar;
}

/// The plugin has already written `.window-state.json` for this exit.
/// Subtract the title bar from the saved content height. A fullscreen frame
/// is the screen size, so that file is left as the plugin wrote it.
#[cfg(target_os = "macos")]
fn correct_saved_window_height(app: &AppHandle) {
    let bar = *app.state::<OverlayTitleBar>().0.lock().unwrap();
    if bar == 0 {
        return;
    }
    let Ok(dir) = app.path().app_config_dir() else {
        return;
    };
    let path = dir.join(tauri_plugin_window_state::DEFAULT_FILENAME);
    let Ok(text) = fs::read_to_string(&path) else {
        return;
    };
    let Ok(mut state) = serde_json::from_str::<serde_json::Value>(&text) else {
        return;
    };
    let Some(window) = state.get_mut("main") else {
        return;
    };
    if window
        .get("fullscreen")
        .and_then(|value| value.as_bool())
        .unwrap_or(false)
    {
        return;
    }
    let Some(height) = window.get("height").and_then(|value| value.as_u64()) else {
        return;
    };
    window["height"] = serde_json::json!(height.saturating_sub(u64::from(bar)));
    let Ok(bytes) = serde_json::to_vec_pretty(&state) else {
        return;
    };
    if let Err(error) = fs::write(&path, bytes) {
        log::warn!("window state height: {error}");
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
    let builder = tauri::Builder::default()
        .manage(OpenedPaths(Mutex::new(vec![])))
        .manage(presigned_put::Uploads::default())
        .manage(ai::Ai::default())
        .manage(mcp_access::Access::default());
    #[cfg(target_os = "macos")]
    let builder = builder.manage(OverlayTitleBar(Mutex::new(0)));
    // Registered before the window exists. `on_window_ready` runs on the main
    // thread during window creation, which is before the setup closure, so a
    // plugin added there never restores state or shows the hidden window.
    #[cfg(desktop)]
    let builder = builder.plugin(
        tauri_plugin_window_state::Builder::new()
            .with_state_flags(
                tauri_plugin_window_state::StateFlags::SIZE
                    | tauri_plugin_window_state::StateFlags::POSITION
                    | tauri_plugin_window_state::StateFlags::MAXIMIZED
                    | tauri_plugin_window_state::StateFlags::FULLSCREEN,
            )
            .build(),
    );
    builder
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
            // The config window starts hidden so restore does not flash the
            // default frame. Visibility is not part of the saved state: a
            // hidden launch used to be written back and the next open stayed
            // invisible.
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
            #[cfg(target_os = "macos")]
            remember_overlay_title_bar(app.handle());
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
                #[cfg(target_os = "macos")]
                correct_saved_window_height(app);
            }
            #[cfg(target_os = "macos")]
            match event {
                tauri::RunEvent::Opened { urls } => {
                    let paths = urls
                        .into_iter()
                        .filter_map(|url| url.to_file_path().ok())
                        .map(|path| path.to_string_lossy().into_owned())
                        .collect();
                    handle_opened_paths(app, paths);
                }
                tauri::RunEvent::WindowEvent { label, event, .. }
                    if label == "main"
                        && matches!(event, tauri::WindowEvent::CloseRequested { .. }) =>
                {
                    remember_overlay_title_bar(app);
                }
                _ => {}
            }
        });
}

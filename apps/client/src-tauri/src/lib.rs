use std::fs;
use std::io::{ErrorKind, Result as IoResult};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

mod ai;
#[cfg(test)]
mod capabilities;
mod launch;
mod mcp_access;
mod mcp_pipe;
mod paths;
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
fn ensure_directory(app: AppHandle, path: String) -> Result<(), String> {
    paths::readable(&app, &path)?;
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
/// boards (plugin-fs `remove` is permanent). Returns the ticket
/// `restore_trashed` takes to put it back (undo): on macOS the path the item
/// got in the Trash, on Windows and Linux the trash item's id. None when the
/// trash cannot tell which item is this one: that delete cannot be undone.
#[tauri::command]
fn trash_path(app: AppHandle, path: String) -> Result<Option<String>, String> {
    // the entry itself: a link goes to the Trash, not what it points to
    paths::writable_entry(&app, &path)?;
    trash_with_ticket(&path)
}

/// Puts a trashed item back where it was (undo of a delete). Refuses when
/// something else took its place meanwhile, or the item left the trash.
#[tauri::command]
fn restore_trashed(app: AppHandle, ticket: String, original_path: String) -> Result<(), String> {
    paths::writable_entry(&app, &original_path)?;
    let original = std::path::Path::new(&original_path);
    if original.symlink_metadata().is_ok() {
        return Err(format!("“{original_path}” already exists"));
    }
    restore_with_ticket(&ticket, original)
}

#[cfg(target_os = "macos")]
fn trash_with_ticket(path: &str) -> Result<Option<String>, String> {
    use objc2::rc::Retained;
    use objc2_foundation::{NSFileManager, NSString, NSURL};
    // Not Finder's AppleScript, which asks to control Finder: the system call
    // moves the item into the Trash without that prompt, and says where to
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let mut resulting: Option<Retained<NSURL>> = None;
    NSFileManager::defaultManager()
        .trashItemAtURL_resultingItemURL_error(&url, Some(&mut resulting))
        .map_err(|error| error.localizedDescription().to_string())?;
    Ok(resulting.and_then(|url| url.path()).map(|path| path.to_string()))
}

/// The ticket is a path, and a rename moves whatever it names: only an item
/// that sits in a Trash is moved back. `~/.Trash` on the home volume,
/// `.Trashes/<uid>` at the root of any other.
#[cfg(target_os = "macos")]
fn is_in_trash(ticket: &std::path::Path) -> bool {
    use std::path::Component;
    if !ticket.is_absolute()
        || ticket
            .components()
            .any(|part| matches!(part, Component::ParentDir))
    {
        return false;
    }
    let Some(parent) = ticket.parent() else {
        return false;
    };
    parent.components().any(|part| {
        matches!(part, Component::Normal(name) if name == ".Trash" || name == ".Trashes")
    })
}

#[cfg(target_os = "macos")]
fn restore_with_ticket(ticket: &str, original: &std::path::Path) -> Result<(), String> {
    if !is_in_trash(std::path::Path::new(ticket)) {
        return Err("the item is not in the Trash".to_string());
    }
    // The Trash cannot be listed without Full Disk Access, but the item's own
    // path in it can be moved: the Trash is on the item's volume, so a rename
    std::fs::rename(ticket, original).map_err(|error| error.to_string())
}

#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))))]
fn trash_with_ticket(path: &str) -> Result<Option<String>, String> {
    use std::collections::HashSet;
    // The trash lists items, not "the one just added": the new item with this
    // original path is the ticket. None or two of them: no undo for it
    let original = std::fs::canonicalize(path).unwrap_or_else(|_| std::path::PathBuf::from(path));
    let before: HashSet<std::ffi::OsString> = trash::os_limited::list()
        .map(|items| items.into_iter().map(|item| item.id).collect())
        .unwrap_or_default();
    trash::delete(path).map_err(|error| error.to_string())?;
    let fresh: Vec<_> = trash::os_limited::list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .filter(|item| !before.contains(&item.id) && item.original_path() == original)
        .collect();
    Ok(match fresh.as_slice() {
        [item] => item.id.to_str().map(str::to_string),
        _ => None,
    })
}

#[cfg(any(target_os = "windows", all(unix, not(target_os = "macos"), not(target_os = "ios"), not(target_os = "android"))))]
fn restore_with_ticket(ticket: &str, _original: &std::path::Path) -> Result<(), String> {
    let item = trash::os_limited::list()
        .map_err(|error| error.to_string())?
        .into_iter()
        .find(|item| item.id.to_str() == Some(ticket))
        .ok_or_else(|| "the item is no longer in the trash".to_string())?;
    trash::os_limited::restore_all([item]).map_err(|error| error.to_string())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn trash_with_ticket(path: &str) -> Result<Option<String>, String> {
    trash::delete(path).map(|_| None).map_err(|error| error.to_string())
}

#[cfg(any(target_os = "ios", target_os = "android"))]
fn restore_with_ticket(_ticket: &str, _original: &std::path::Path) -> Result<(), String> {
    Err("the trash cannot be read here".to_string())
}

#[cfg(all(test, target_os = "macos"))]
mod trash_ticket_tests {
    /// Touches the real Trash: run by hand with `cargo test -- --ignored`
    #[test]
    #[ignore]
    fn a_trashed_file_comes_back_by_its_ticket() {
        let dir = std::env::temp_dir().join(format!("pile-trash-ticket-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let file = dir.join("probe.txt");
        std::fs::write(&file, "probe").unwrap();
        let path = file.to_str().unwrap().to_string();

        let ticket = super::trash_with_ticket(&path).unwrap().expect("a ticket");
        assert!(!file.exists());
        super::restore_with_ticket(&ticket, &file).unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "probe");
        std::fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn only_an_item_in_a_trash_is_moved_back() {
        use std::path::Path;
        assert!(super::is_in_trash(Path::new("/Users/ann/.Trash/notes.txt")));
        assert!(super::is_in_trash(Path::new("/Users/ann/.Trash/Folder 12.34.56/a.txt")));
        assert!(super::is_in_trash(Path::new("/Volumes/Stick/.Trashes/501/photo.jpg")));

        assert!(!super::is_in_trash(Path::new("/Users/ann/Documents/evil.plist")));
        assert!(!super::is_in_trash(Path::new("/Users/ann/.Trash")));
        assert!(!super::is_in_trash(Path::new("/Users/ann/.Trash/../Documents/a.txt")));
        assert!(!super::is_in_trash(Path::new(".Trash/a.txt")));
    }
}

/// Returns `"directory"`, `"file"`, or `"other"` for an existing path.
#[tauri::command]
fn path_kind(app: AppHandle, path: String) -> Result<&'static str, String> {
    paths::readable(&app, &path)?;
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
    for path in &paths {
        crate::paths::grant_opened(app, std::path::Path::new(path));
        crate::paths::remember_granted(app, std::path::Path::new(path));
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

/// A page of the app itself: the bundled files (`tauri://localhost`, or
/// `http(s)://tauri.localhost` on Windows) and, under `tauri dev`, the dev
/// server. `about:` is the blank document a new frame starts from.
fn is_app_url(url: &tauri::Url, dev_url: Option<&tauri::Url>) -> bool {
    match url.scheme() {
        "tauri" => url.host_str() == Some("localhost"),
        "http" | "https" => {
            url.host_str() == Some("tauri.localhost")
                || dev_url.is_some_and(|dev| dev.origin() == url.origin())
        }
        "about" => true,
        _ => false,
    }
}

/// The window never leaves the app. The page already sends link clicks to
/// the system browser (services/openExternal.ts), but a link it does not
/// know about — some element a sanitizer let through — would replace the
/// app with another site in a window that has no address bar. Whatever
/// tries to navigate, only the app's own pages load here.
fn navigation_guard<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri::plugin::Builder::new("navigation-guard")
        .on_navigation(|webview, url| {
            let dev_url = if tauri::is_dev() {
                webview.config().build.dev_url.clone()
            } else {
                None
            };
            let allowed = is_app_url(url, dev_url.as_ref());
            if !allowed {
                log::warn!("navigation refused: {}", url.scheme());
            }
            allowed
        })
        .build()
}

#[cfg(test)]
mod navigation_tests {
    use super::is_app_url;

    fn url(text: &str) -> tauri::Url {
        tauri::Url::parse(text).unwrap()
    }

    #[test]
    fn the_window_stays_on_the_apps_own_pages() {
        assert!(is_app_url(&url("tauri://localhost/"), None));
        assert!(is_app_url(&url("tauri://localhost/demo/Features"), None));
        assert!(is_app_url(&url("http://tauri.localhost/index.html"), None));
        assert!(is_app_url(&url("https://tauri.localhost/"), None));
        assert!(is_app_url(&url("about:blank"), None));

        assert!(!is_app_url(&url("https://evil.example/login"), None));
        assert!(!is_app_url(&url("http://localhost:5173/"), None));
        assert!(!is_app_url(&url("tauri://evil.example/"), None));
        assert!(!is_app_url(&url("https://tauri.localhost.evil.example/"), None));
        assert!(!is_app_url(&url("file:///Users/ann/.ssh/id_rsa"), None));
        assert!(!is_app_url(&url("blob:tauri://localhost/1b2c"), None));
        assert!(!is_app_url(&url("data:text/html,<script>1</script>"), None));
        assert!(!is_app_url(&url("javascript:alert(1)"), None));
    }

    #[test]
    fn the_dev_server_is_a_page_of_the_app_only_under_tauri_dev() {
        let dev = url("http://localhost:5173");
        assert!(is_app_url(&url("http://localhost:5173/demo"), Some(&dev)));
        assert!(!is_app_url(&url("http://localhost:8080/"), Some(&dev)));
        assert!(!is_app_url(&url("https://evil.example/"), Some(&dev)));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .manage(OpenedPaths(Mutex::new(vec![])))
        .manage(presigned_put::Uploads::default())
        .manage(workspace_pack::PileZips::default())
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
        .plugin(navigation_guard())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        // Layout attributes follow the files the app may read: they are
        // `user.*` metadata, not content, so `Library` keeps its layout too.
        .plugin(
            tauri_plugin_xattrs::Builder::new()
                .guard(|app, path, _access| paths::readable(app, path).map(|_| ()))
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            take_opened_paths,
            ensure_directory,
            path_kind,
            trash_path,
            restore_trashed,
            launch::open_path,
            workspace_pack::export_workspace_zip,
            workspace_pack::import_workspace_zip,
            workspace_pack::pile_zip_begin,
            workspace_pack::pile_zip_folder,
            workspace_pack::pile_zip_file,
            workspace_pack::pile_zip_finish,
            workspace_pack::pile_zip_abort,
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
            // Folders outside home the person gave the app earlier
            paths::restore_granted(app.handle());
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
            // plugin-fs lets the window into what was dropped on it; a folder
            // is also remembered for the next launch
            if let tauri::RunEvent::WindowEvent {
                event: tauri::WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }),
                ..
            } = &event
            {
                for path in paths {
                    crate::paths::remember_granted(app, path);
                }
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

mod backend;
mod commands;
mod models;

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub use models::{FolderWithChildrenXattrs, PathXattrsEntry, Xattr};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("xattrs")
        .invoke_handler(tauri::generate_handler![
            commands::set_xattr,
            commands::get_xattr,
            commands::remove_xattr,
            commands::list_xattrs,
            commands::folder_with_children_xattrs,
        ])
        .build()
}

mod backend;
mod commands;
mod models;

use std::sync::Arc;

use tauri::{
    plugin::{Builder as PluginBuilder, TauriPlugin},
    AppHandle, Manager, Runtime,
};

pub use models::{FolderWithChildrenXattrs, PathXattrsEntry, Xattr};

/// What a command is about to do with a path.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// read attributes, or list a folder with its children's attributes
    Read,
    /// set or remove an attribute
    Write,
}

type Guard<R> = dyn Fn(&AppHandle<R>, &str, Access) -> Result<(), String> + Send + Sync;

/// The app's rule for which paths the commands may touch. Without one every
/// path the process can reach is allowed.
pub(crate) struct PathGuard<R: Runtime>(Option<Arc<Guard<R>>>);

pub(crate) fn check<R: Runtime>(app: &AppHandle<R>, path: &str, access: Access) -> Result<(), String> {
    match app.try_state::<PathGuard<R>>() {
        Some(guard) => match &guard.0 {
            Some(allows) => allows(app, path, access),
            None => Ok(()),
        },
        None => Ok(()),
    }
}

pub struct Builder<R: Runtime> {
    guard: Option<Arc<Guard<R>>>,
}

impl<R: Runtime> Default for Builder<R> {
    fn default() -> Self {
        Self { guard: None }
    }
}

impl<R: Runtime> Builder<R> {
    pub fn new() -> Self {
        Self::default()
    }

    /// Every command asks `guard` before it touches a path: an `Err` is
    /// returned to the caller and nothing is read or written. The commands
    /// are callable from the webview, so an app that fences its file access
    /// should fence these the same way.
    pub fn guard(
        mut self,
        guard: impl Fn(&AppHandle<R>, &str, Access) -> Result<(), String> + Send + Sync + 'static,
    ) -> Self {
        self.guard = Some(Arc::new(guard));
        self
    }

    pub fn build(self) -> TauriPlugin<R> {
        let guard = self.guard;
        PluginBuilder::new("xattrs")
            .invoke_handler(tauri::generate_handler![
                commands::set_xattr,
                commands::get_xattr,
                commands::remove_xattr,
                commands::list_xattrs,
                commands::folder_with_children_xattrs,
            ])
            .setup(move |app, _api| {
                app.manage(PathGuard::<R>(guard));
                Ok(())
            })
            .build()
    }
}

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new().build()
}

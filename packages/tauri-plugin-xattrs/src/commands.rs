use crate::models::{FolderWithChildrenXattrs, PathXattrsEntry, Xattr};
use std::fs;
use std::io::{self, ErrorKind};
use std::path::Path;

/// Sidecar dir with per-folder ink data — never surfaced as a board child.
const PILE_DIR_NAME: &str = ".pile";

/// macOS Finder metadata file — never surfaced as a board child.
const DS_STORE_NAME: &str = ".DS_Store";

fn list_xattrs_at(path: &str) -> io::Result<Vec<Xattr>> {
    let mut xattrs = Vec::new();

    for name in crate::backend::list(path)? {
        let value = match crate::backend::get(path, &name)? {
            Some(bytes) => String::from_utf8_lossy(&bytes).to_string(),
            None => String::new(),
        };
        xattrs.push(Xattr { name, value });
    }

    Ok(xattrs)
}

fn set_xattr_at(path: &str, name: &str, value: &str) -> io::Result<()> {
    crate::backend::set(path, name, value.as_bytes())
}

fn get_xattr_at(path: &str, name: &str) -> io::Result<Option<String>> {
    match crate::backend::get(path, name)? {
        Some(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).to_string())),
        None => Ok(None),
    }
}

fn remove_xattr_at(path: &str, name: &str) -> io::Result<()> {
    crate::backend::remove(path, name)
}

fn path_xattrs_entry(path: &Path, entry_type: &str) -> io::Result<PathXattrsEntry> {
    let path_str = path.to_string_lossy().into_owned();
    Ok(PathXattrsEntry {
        path: path_str.clone(),
        name: path
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default(),
        entry_type: entry_type.to_string(),
        xattrs: list_xattrs_at(&path_str)?,
    })
}

fn folder_with_children_xattrs_at(folder_path: &str) -> io::Result<FolderWithChildrenXattrs> {
    let folder = Path::new(folder_path);
    let metadata = fs::metadata(folder)?;
    if !metadata.is_dir() {
        return Err(io::Error::new(
            ErrorKind::InvalidInput,
            "path is not a directory",
        ));
    }

    let mut children = Vec::new();
    for entry in fs::read_dir(folder)? {
        let entry = entry?;
        if entry.file_name() == PILE_DIR_NAME || entry.file_name() == DS_STORE_NAME {
            continue;
        }
        let path = entry.path();
        let file_type = entry.file_type()?;
        let entry_type = if file_type.is_dir() {
            "folder"
        } else {
            "file"
        };
        children.push(path_xattrs_entry(&path, entry_type)?);
    }

    children.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));

    Ok(FolderWithChildrenXattrs {
        folder: path_xattrs_entry(folder, "folder")?,
        children,
    })
}

/// Runs a read on Tauri's blocking thread pool. Synchronous commands run on
/// the main thread, and a read that macOS holds back
/// (a TCC-protected folder) would freeze the whole window. The io::Error
/// text is kept as is, so callers still see e.g.
/// "Operation not permitted (os error 1)".
async fn run_blocking<T, F>(op: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> io::Result<T> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(op)
        .await
        .map_err(|e| format!("xattrs task failed: {e}"))?
        .map_err(|e| e.to_string())
}

/// Writes stay synchronous, on the main thread, so they land in the order
/// they were called: two quick `position` writes on the blocking pool could
/// finish in reverse and leave the older value on disk. A write goes to a
/// file the user already opened, so it does not wait on a privacy prompt.
#[tauri::command]
pub fn set_xattr(path: String, name: String, value: String) -> Result<(), String> {
    if name.trim().is_empty() {
        return Err("Attribute name cannot be empty".into());
    }
    set_xattr_at(&path, &name, &value).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn get_xattr(path: String, name: String) -> Result<Option<String>, String> {
    run_blocking(move || get_xattr_at(&path, &name)).await
}

/// Synchronous for the same reason as `set_xattr`: call order is write order.
#[tauri::command]
pub fn remove_xattr(path: String, name: String) -> Result<(), String> {
    remove_xattr_at(&path, &name).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn list_xattrs(path: String) -> Result<Vec<Xattr>, String> {
    run_blocking(move || list_xattrs_at(&path)).await
}

#[tauri::command]
pub async fn folder_with_children_xattrs(path: String) -> Result<FolderWithChildrenXattrs, String> {
    run_blocking(move || folder_with_children_xattrs_at(&path)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn crud_xattrs() {
        let path = std::env::temp_dir().join("tauri-plugin-xattrs-test.txt");
        fs::write(&path, b"content").unwrap();
        let path = path.to_string_lossy();

        set_xattr_at(&path, "author", "alice").unwrap();
        let xattrs = list_xattrs_at(&path).unwrap();
        assert_eq!(xattrs.len(), 1);
        assert_eq!(xattrs[0].name, "author");
        assert_eq!(xattrs[0].value, "alice");

        assert_eq!(get_xattr_at(&path, "author").unwrap(), Some("alice".into()));

        set_xattr_at(&path, "author", "bob").unwrap();
        let xattrs = list_xattrs_at(&path).unwrap();
        assert_eq!(xattrs[0].value, "bob");

        remove_xattr_at(&path, "author").unwrap();
        let xattrs = list_xattrs_at(&path).unwrap();
        assert!(xattrs.is_empty());

        fs::remove_file(path.as_ref()).unwrap();
    }

    #[test]
    fn crud_xattrs_on_directory() {
        let path = std::env::temp_dir().join("tauri-plugin-xattrs-test-dir");
        fs::create_dir_all(&path).unwrap();
        let path = path.to_string_lossy();

        set_xattr_at(&path, "label", "archive").unwrap();
        let xattrs = list_xattrs_at(&path).unwrap();
        assert_eq!(xattrs.len(), 1);
        assert_eq!(xattrs[0].name, "label");
        assert_eq!(xattrs[0].value, "archive");

        remove_xattr_at(&path, "label").unwrap();
        let xattrs = list_xattrs_at(&path).unwrap();
        assert!(xattrs.is_empty());

        fs::remove_dir(path.as_ref()).unwrap();
    }

    #[test]
    fn folder_with_children_xattrs_includes_folder_and_children() {
        let root = std::env::temp_dir().join("tauri-plugin-xattrs-tree-test");
        let sub = root.join("sub");
        let file = root.join("doc.txt");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&sub).unwrap();
        fs::write(&file, b"content").unwrap();

        let root_str = root.to_string_lossy();
        let sub_str = sub.to_string_lossy();
        let file_str = file.to_string_lossy();

        set_xattr_at(&root_str, "root_tag", "root").unwrap();
        set_xattr_at(&sub_str, "sub_tag", "sub").unwrap();
        set_xattr_at(&file_str, "file_tag", "file").unwrap();

        let result = folder_with_children_xattrs_at(&root_str).unwrap();

        assert_eq!(result.folder.entry_type, "folder");
        assert_eq!(result.folder.path, root_str.as_ref());
        assert_eq!(result.folder.xattrs[0].name, "root_tag");

        assert_eq!(result.children.len(), 2);

        let doc = result
            .children
            .iter()
            .find(|e| e.path == file_str.as_ref())
            .unwrap();
        assert_eq!(doc.entry_type, "file");
        assert_eq!(doc.xattrs[0].value, "file");

        let sub_entry = result
            .children
            .iter()
            .find(|e| e.path == sub_str.as_ref())
            .unwrap();
        assert_eq!(sub_entry.entry_type, "folder");
        assert_eq!(sub_entry.xattrs[0].value, "sub");

        remove_xattr_at(&root_str, "root_tag").unwrap();
        remove_xattr_at(&sub_str, "sub_tag").unwrap();
        remove_xattr_at(&file_str, "file_tag").unwrap();
        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn folder_with_children_xattrs_excludes_pile_dir() {
        let root = std::env::temp_dir().join("tauri-plugin-xattrs-pile-test");
        let pile = root.join(PILE_DIR_NAME);
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&pile).unwrap();
        fs::write(root.join("doc.txt"), b"content").unwrap();
        fs::write(pile.join("strokes.json"), b"[]").unwrap();

        let root_str = root.to_string_lossy();
        let result = folder_with_children_xattrs_at(&root_str).unwrap();

        assert_eq!(result.children.len(), 1);
        assert_eq!(result.children[0].name, "doc.txt");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn folder_with_children_xattrs_excludes_ds_store() {
        let root = std::env::temp_dir().join("tauri-plugin-xattrs-ds-store-test");
        fs::remove_dir_all(&root).ok();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("doc.txt"), b"content").unwrap();
        fs::write(root.join(DS_STORE_NAME), b"").unwrap();

        let root_str = root.to_string_lossy();
        let result = folder_with_children_xattrs_at(&root_str).unwrap();

        assert_eq!(result.children.len(), 1);
        assert_eq!(result.children[0].name, "doc.txt");

        fs::remove_dir_all(&root).unwrap();
    }

    #[test]
    fn commands_run_off_the_calling_thread_and_keep_io_error_text() {
        let caller = std::thread::current().id();
        let ran_on = tauri::async_runtime::block_on(run_blocking(|| Ok(std::thread::current().id())))
            .unwrap();
        assert_ne!(ran_on, caller);

        let missing = std::env::temp_dir().join("tauri-plugin-xattrs-missing-dir");
        fs::remove_dir_all(&missing).ok();
        let expected = fs::metadata(&missing).unwrap_err().to_string();
        let error = tauri::async_runtime::block_on(folder_with_children_xattrs(
            missing.to_string_lossy().into_owned(),
        ))
        .unwrap_err();
        assert_eq!(error, expected);
        assert!(error.contains("os error 2"));

        let denied = tauri::async_runtime::block_on(run_blocking::<(), _>(|| {
            Err(io::Error::from_raw_os_error(1))
        }))
        .unwrap_err();
        assert!(denied.contains("Operation not permitted") && denied.contains("os error 1"));
    }

    #[test]
    fn empty_attribute_name_is_rejected_as_before() {
        let error = set_xattr("/tmp".into(), " ".into(), "v".into()).unwrap_err();
        assert_eq!(error, "Attribute name cannot be empty");
    }
}

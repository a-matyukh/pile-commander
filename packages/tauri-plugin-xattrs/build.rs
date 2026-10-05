const COMMANDS: &[&str] = &[
    "set_xattr",
    "get_xattr",
    "remove_xattr",
    "list_xattrs",
    "folder_with_children_xattrs",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS).build();
}

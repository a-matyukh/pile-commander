# @pile-commander/tauri-plugin-xattrs

Tauri v2 plugin for cross-platform extended file attributes.

On Unix (Linux, macOS, BSD), attributes use the `user.*` xattr namespace. On Windows, NTFS Alternate Data Streams are used.

## Installation

### Rust (Tauri app)

Add a path dependency in `src-tauri/Cargo.toml`:

```toml
[dependencies]
tauri-plugin-xattrs = { path = "../../../packages/tauri-plugin-xattrs" }
```

Register the plugin in `src-tauri/src/lib.rs`:

```rust
tauri::Builder::default()
    .plugin(tauri_plugin_xattrs::init())
    // ...
```

Add the default permission set in `src-tauri/capabilities/default.json`:

```json
{
  "permissions": [
    "core:default",
    "xattrs:default"
  ]
}
```



### JavaScript / TypeScript

Add the workspace package to your app `package.json`:

```json
{
  "dependencies": {
    "@pile-commander/tauri-plugin-xattrs": "workspace:*"
  }
}
```



## API

All functions use **snake_case** and map 1:1 to plugin commands.

```typescript
import {
  set_xattr,
  get_xattr,
  remove_xattr,
  list_xattrs,
  folder_with_children_xattrs,
} from "@pile-commander/tauri-plugin-xattrs"
```



### `set_xattr(path, name, value)`

Set an extended attribute on a file or directory.

```typescript
await set_xattr("/path/to/file.txt", "author", "alice")
```



### `get_xattr(path, name)`

Read a single attribute value. Returns `null` if the attribute does not exist.

```typescript
const value = await get_xattr("/path/to/file.txt", "author") // "alice"
```



### `remove_xattr(path, name)`

Remove an extended attribute.

```typescript
await remove_xattr("/path/to/file.txt", "author")
```



### `list_xattrs(path)`

List all extended attributes on a file or directory with their values.

```typescript
const xattrs = await list_xattrs("/path/to/file.txt")
// [{ name: "author", value: "alice" }, ...]
```



### `folder_with_children_xattrs(path)`

Read xattrs for a folder and its immediate children (non-recursive).

```typescript
const tree = await folder_with_children_xattrs("/path/to/folder")
// tree.folder.xattrs → [{ name: "tag", value: "..." }, ...]
// tree.children     → [{ path, name, type, xattrs }, ...]
```

Return type:

```typescript
type Xattr = { name: string; value: string }

type PathXattrsEntry = {
  path: string
  name: string
  type: "file" | "folder"
  xattrs: Xattr[]
}

type FolderWithChildrenXattrs = {
  folder: PathXattrsEntry
  children: PathXattrsEntry[]
}
```



## Platform notes

- On Windows and macOS, `fs::copy` can preserve extended attributes.
- On Linux, only `cp --preserve=xattr` preserves them.
- Attributes are discarded when uploading files to the internet or copying to incompatible filesystems.



## Development

```bash
cd packages/tauri-plugin-xattrs
cargo test
cargo check
bun run build   # TypeScript typecheck
```


import { invoke } from "@tauri-apps/api/core"
import type { FolderWithChildrenXattrs, Xattr } from "./types"

export type { FolderWithChildrenXattrs, PathXattrsEntry, Xattr } from "./types"

export async function set_xattr(
	path: string,
	name: string,
	value: string,
): Promise<void> {
	await invoke("plugin:xattrs|set_xattr", { path, name, value })
}

export async function get_xattr(
	path: string,
	name: string,
): Promise<string | null> {
	return invoke<string | null>("plugin:xattrs|get_xattr", { path, name })
}

export async function remove_xattr(
	path: string,
	name: string,
): Promise<void> {
	await invoke("plugin:xattrs|remove_xattr", { path, name })
}

export async function list_xattrs(path: string): Promise<Xattr[]> {
	return invoke<Xattr[]>("plugin:xattrs|list_xattrs", { path })
}

export async function folder_with_children_xattrs(
	path: string,
): Promise<FolderWithChildrenXattrs> {
	return invoke<FolderWithChildrenXattrs>(
		"plugin:xattrs|folder_with_children_xattrs",
		{ path },
	)
}

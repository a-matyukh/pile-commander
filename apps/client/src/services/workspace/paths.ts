/** Prefer `\` when the path looks Windows-like; otherwise `/`. */
export function path_separator(path: string): string {
	return path.includes('\\') ? '\\' : '/'
}

/** Strip trailing `/` or `\` so the same folder is one id (`/foo` vs `/foo/`). Keeps `/` and `\`. */
export function normalize_workspace_id(id: string): string {
	const stripped = id.replace(/[/\\]+$/, '')
	if (stripped) return stripped
	return id.includes('\\') ? '\\' : '/'
}

export function parent_folder_id_from_node_id(node_id: string, workspace_id: string): string {
	const sep = path_separator(node_id)
	const last_sep = node_id.lastIndexOf(sep)
	if (last_sep <= 0) return workspace_id

	const parent = node_id.slice(0, last_sep)
	return parent || workspace_id
}

/** Renames `old_id` and any descendant paths (`old_id` + separator + …) inside a Set. */
export function rename_ids_in_set(set: Set<string>, old_id: string, new_id: string): void {
	const sep = path_separator(old_id)
	const updates: [string, string][] = []

	for (const id of set) {
		if (id === old_id) {
			updates.push([id, new_id])
		} else if (id.startsWith(old_id + sep)) {
			updates.push([id, new_id + id.slice(old_id.length)])
		}
	}

	for (const [from, to] of updates) {
		set.delete(from)
		set.add(to)
	}
}

/** Renames `old_id` and any descendant paths inside an array, in place. */
export function rename_ids_in_array(arr: string[], old_id: string, new_id: string): void {
	const sep = path_separator(old_id)
	for (let i = 0; i < arr.length; i++) {
		const id = arr[i]!
		if (id === old_id) {
			arr[i] = new_id
		} else if (id.startsWith(old_id + sep)) {
			arr[i] = new_id + id.slice(old_id.length)
		}
	}
}

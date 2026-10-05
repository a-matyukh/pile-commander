import type { EntryWithXattrs, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import { path_separator, rename_ids_in_array } from './paths'
import { rename_ids_in_set } from './tree'
import { maybe_sync_tree_from_folders } from './batchFsUpdate'
import { rekey_pending_entry_xattrs } from './xattrs'

/**
 * Minimal shape of the workspace state the mutation helpers operate on.
 * WorkspaceStore satisfies it structurally.
 */
export type WorkspaceState = {
	/** Workspace root id. */
	id: string
	tree: WorkspaceTree
	expanded_folder_ids: Set<string>
	loading_folder_ids: Set<string>
	/** Folder ids whose children are shown in the sidebar tree. */
	tree_loaded_folder_ids: Set<string>
	selection: string[]
	folders: Record<string, FolderWithChildrenXattrs>
	opened_folder_id: string
	folder_back_stack?: string[]
	/**
	 * Open folder tabs. The active tab is already covered by the
	 * opened_folder_id / folder_back_stack handling above (the store
	 * delegates those accessors to it); loops over tabs keep background
	 * tabs consistent too (rewrites are idempotent).
	 */
	tabs?: {
		folder_id: string
		back_stack: string[]
	}[]
}

/** Finds the child entry for `id` in any cached folder. */
export function find_child_entry(
	folders: Record<string, FolderWithChildrenXattrs>,
	id: string,
): EntryWithXattrs | undefined {
	for (const folder of Object.values(folders)) {
		const child = folder.children?.find(c => c.id === id)
		if (child) return child
	}
	return undefined
}

/** Registers a newly created entry in the folder cache and refreshes the tree. */
export function apply_entry_created(
	state: WorkspaceState,
	folder_id: string,
	entry: EntryWithXattrs,
): void {
	const folder_data = state.folders[folder_id]
	if (!folder_data) return

	if (!folder_data.children) {
		folder_data.children = []
	}
	// A watch/realtime refresh may have already registered this entry — keep
	// that child but lay the created xattrs (position) over what it read
	const existing = folder_data.children.find(c => c.id === entry.id)
	if (!existing) {
		folder_data.children.push(entry)
	} else {
		const created = new Map(entry.xattrs.map(x => [x.name, x.value]))
		existing.xattrs = [
			...existing.xattrs.filter(x => !created.has(x.name)),
			...entry.xattrs.map(x => ({ ...x })),
		]
	}

	if (folder_id !== state.id) {
		state.expanded_folder_ids.add(folder_id)
		state.tree_loaded_folder_ids.add(folder_id)
	}

	maybe_sync_tree_from_folders(state)
}

/** Removes every trace of an entry from the workspace state. */
export function apply_entry_removed(state: WorkspaceState, id: string): void {
	state.expanded_folder_ids.delete(id)
	state.tree_loaded_folder_ids.delete(id)
	state.loading_folder_ids.delete(id)

	const selected = state.selection.indexOf(id)
	if (selected !== -1) {
		state.selection.splice(selected, 1)
	}

	// Keep the opened folder cached: consumers may still read it until
	// the caller switches to another folder.
	if (state.opened_folder_id !== id) {
		delete state.folders[id]
	}

	for (const folder of Object.values(state.folders)) {
		const index = folder.children?.findIndex(c => c.id === id) ?? -1
		if (index !== -1) {
			folder.children!.splice(index, 1)
		}
	}

	if (state.folder_back_stack) {
		const sep = path_separator(id)
		const prefix = id + sep
		state.folder_back_stack = state.folder_back_stack.filter(
			stack_id => stack_id !== id && !stack_id.startsWith(prefix),
		)
	}

	if (state.tabs) {
		const sep = path_separator(id)
		const prefix = id + sep
		for (const tab of state.tabs) {
			tab.back_stack = tab.back_stack.filter(
				stack_id => stack_id !== id && !stack_id.startsWith(prefix),
			)
		}
	}

	maybe_sync_tree_from_folders(state)
}

/**
 * Applies the full "id is a path" cascade after a rename or move:
 * id sets, selection, child entries and the folder cache key.
 */
export function apply_id_changed(
	state: WorkspaceState,
	old_id: string,
	new_id: string,
	new_name: string,
): void {
	rename_ids_in_set(state.expanded_folder_ids, old_id, new_id)
	rename_ids_in_set(state.loading_folder_ids, old_id, new_id)
	rename_ids_in_set(state.tree_loaded_folder_ids, old_id, new_id)
	if (state.folder_back_stack) {
		rename_ids_in_array(state.folder_back_stack, old_id, new_id)
	}

	const selected = state.selection.indexOf(old_id)
	if (selected !== -1) {
		state.selection.splice(selected, 1)
		state.selection.push(new_id)
	}

	const sep = path_separator(old_id)
	const old_prefix = old_id + sep

	for (const folder of Object.values(state.folders)) {
		for (const child of folder.children ?? []) {
			if (child.id === old_id) {
				child.id = new_id
				child.name = new_name
			} else if (child.id.startsWith(old_prefix)) {
				child.id = new_id + child.id.slice(old_id.length)
			}
		}
	}

	for (const key of Object.keys(state.folders)) {
		if (key !== old_id && !key.startsWith(old_prefix)) continue
		const cached = state.folders[key]!
		const new_key = new_id + key.slice(old_id.length)
		state.folders[new_key] = cached
		cached.id = new_key
		if (key === old_id) {
			cached.name = new_name
		}
		delete state.folders[key]
	}

	if (state.opened_folder_id === old_id) {
		state.opened_folder_id = new_id
	} else if (state.opened_folder_id.startsWith(old_prefix)) {
		state.opened_folder_id = new_id + state.opened_folder_id.slice(old_id.length)
	}

	if (state.tabs) {
		for (const tab of state.tabs) {
			rename_ids_in_array(tab.back_stack, old_id, new_id)
			if (tab.folder_id === old_id) {
				tab.folder_id = new_id
			} else if (tab.folder_id.startsWith(old_prefix)) {
				tab.folder_id = new_id + tab.folder_id.slice(old_id.length)
			}
		}
	}

	rekey_pending_entry_xattrs(old_id, new_id)

	maybe_sync_tree_from_folders(state)
}

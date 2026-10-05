import type { FolderWithChildrenXattrs, FileManager, WatchEvent } from '@pile-commander/file-manager'
import {
	apply_entry_removed,
	apply_id_changed,
	type WorkspaceState,
} from '@/services/workspace/mutations'
import {
	parent_folder_id_from_node_id,
	sync_tree_from_folders,
} from '@/services/workspace/tree'
import { folder_cache_generation, apply_pending_entry_xattrs } from '@/services/workspace/xattrs'
import {
	invalidate_entry_content_caches,
	rekey_entry_content_caches,
	type EntryContentCaches,
} from '@/ui/workspace/folder-container/textContentCache'
import { is_missing_path_error } from './fsErrors'
import { report_error } from './reportError'
import {
	rename_folder_canvas_connections,
	type CanvasPersistStore,
} from './persistCanvas'

/** Cached folder ids that should be re-fetched for the given watch paths. */
export function cached_folders_affected_by(
	folders: Record<string, FolderWithChildrenXattrs>,
	ids: string[],
	workspace_id: string,
	event_kind?: WatchEvent['kind'],
): string[] {
	const to_refresh = new Set<string>()
	for (const id of ids) {
		// A removed path is gone — refreshing it only yields ENOENT.
		// Parents still need a refresh to drop the child from the cache.
		if (folders[id] && event_kind !== 'remove') {
			to_refresh.add(id)
		}
		let current = id
		for (;;) {
			const parent = parent_folder_id_from_node_id(current, workspace_id)
			if (folders[parent]) {
				to_refresh.add(parent)
			}
			if (parent === workspace_id || parent === current) break
			current = parent
		}
	}
	return [...to_refresh]
}

/**
 * Re-fetches a cached folder from disk, replaces the cache entry and
 * refreshes the projected tree; cleans up disappeared entries.
 *
 * Retries when a local xattr write bumps the folder cache generation during
 * the fetch — otherwise a stale snapshot can overwrite an optimistic update
 * (e.g. folder view switch appears to do nothing until the folder is re-opened).
 */
export async function refresh_cached_folder(
	store: WorkspaceState & CanvasPersistStore & { content_caches: EntryContentCaches },
	fm: FileManager,
	folder_id: string,
	event: WatchEvent,
): Promise<void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (!store.folders[folder_id]) return

		const generation_at_start = folder_cache_generation(folder_id)
		const previous_children = store.folders[folder_id]!.children ?? []
		const old_child_ids = new Set(previous_children.map(c => c.id))

		let folder_data: FolderWithChildrenXattrs
		try {
			folder_data = await fm.folder_with_children_xattrs(folder_id)
		} catch (error) {
			// Nested preview folders often linger in `store.folders` until the
			// watch refresh runs; once deleted they must be dropped quietly.
			if (
				is_missing_path_error(error)
				&& folder_id !== store.id
				&& store.opened_folder_id !== folder_id
			) {
				invalidate_entry_content_caches(store.content_caches, folder_id)
				apply_entry_removed(store, folder_id)
				return
			}
			report_error(store, error)
			return
		}

		if (!store.folders[folder_id]) return

		if (folder_cache_generation(folder_id) !== generation_at_start) {
			continue
		}

		apply_pending_entry_xattrs(folder_data)

		const new_children = folder_data.children ?? []
		const new_child_ids = new Set(new_children.map(c => c.id))
		const disappeared = [...old_child_ids].filter(id => !new_child_ids.has(id))
		const appeared = [...new_child_ids].filter(id => !old_child_ids.has(id))

		const is_rename =
			event.kind === 'rename'
			&& disappeared.length === 1
			&& appeared.length === 1
		let renamed_old_id: string | undefined
		let renamed_new_id: string | undefined

		if (is_rename) {
			const old_id = disappeared[0]!
			const new_id = appeared[0]!
			const new_name = new_children.find(c => c.id === new_id)?.name ?? new_id
		renamed_old_id = old_id
		renamed_new_id = new_id
		rekey_entry_content_caches(store.content_caches, old_id, new_id)
		apply_id_changed(store, old_id, new_id, new_name)
		}

		store.folders[folder_id] = folder_data

	if (renamed_old_id && renamed_new_id) {
		await rename_folder_canvas_connections(store, renamed_old_id, renamed_new_id)
	}

	if (!is_rename) {
		for (const id of disappeared) {
			invalidate_entry_content_caches(store.content_caches, id)
			apply_entry_removed(store, id)
		}
	}

		sync_tree_from_folders(store)
		return
	}
}

import type { FolderWithChildrenXattrs, FileManager } from '@pile-commander/file-manager'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import { children_orders_match, sort_entries_by_order_then_name } from '@/services/workspace/folderContainer'
import {
	bump_folder_cache_generation,
	clear_pending_entry_xattr,
	notify_children_reordered,
	set_pending_entry_xattr,
	sync_xattr_to_preview_folders,
	upsert_folder_xattr,
} from '@/services/workspace/xattrs'
import { sync_tree_from_folders } from '@/services/workspace/tree'
import { report_error } from './reportError'

export async function persist_children_order(
	store: {
		last_error: string | null
		tree: WorkspaceTree
		id: string
		folders: Record<string, FolderWithChildrenXattrs>
		tree_loaded_folder_ids: Set<string>
		opened_folder: FolderWithChildrenXattrs
		preview_folders: Record<string, FolderWithChildrenXattrs>
		resolve_folder_data(folder_id: string): FolderWithChildrenXattrs | null
	},
	fm: Pick<FileManager, 'set_xattrs'>,
	folder_id: string,
	ordered_ids: string[],
): Promise<boolean> {
	const folder_data = store.resolve_folder_data(folder_id)
	if (!folder_data) {
		return false
	}

	const children = folder_data.children ?? []
	if (ordered_ids.length !== children.length) {
		return false
	}

	const ids = new Set(children.map(c => c.id))
	if (!ordered_ids.every(id => ids.has(id))) {
		return false
	}

	if (children_orders_match(children, ordered_ids)) {
		return true
	}

	// Optimistic: the new order shows at once and only the entries whose index
	// changed are written (a cloud folder used to wait on each write)
	const order_of = (entry: FolderWithChildrenXattrs['children'][number]) =>
		entry.xattrs.find(x => x.name === 'order')?.value ?? null
	const previous = new Map(children.map(child => [child.id, order_of(child)]))
	const changed = ordered_ids
		.map((id, index) => ({ id, value: String(index) }))
		.filter(({ id, value }) => previous.get(id) !== value)

	const live = store.folders[folder_id] ?? folder_data
	for (const { id, value } of changed) {
		upsert_folder_xattr(live, id, 'order', value)
		sync_xattr_to_preview_folders(store.preview_folders, live, id, 'order', value)
	}
	const by_id = new Map((live.children ?? []).map(c => [c.id, c]))
	live.children = ordered_ids.map(id => by_id.get(id)!)
	notify_children_reordered(live)
	sync_tree_from_folders(store)

	// One batch: a cloud folder writes the whole order in one request and one
	// transaction, so it lands whole or not at all (separate writes could leave
	// two entries at the same index when one of them failed)
	bump_folder_cache_generation(folder_id)
	for (const { id, value } of changed) set_pending_entry_xattr(id, 'order', value)
	let failed: Set<string>
	try {
		const { missing } = changed.length > 0
			? await fm.set_xattrs(changed.map(({ id, value }) => ({ id, xattrs: { order: value } })))
			: { missing: [] }
		failed = new Set(missing)
		if (failed.size > 0) report_error(store, new Error(`entry not found: ${[...failed].join(', ')}`))
	} catch (error) {
		failed = new Set(changed.map(({ id }) => id))
		report_error(store, error)
	}
	bump_folder_cache_generation(folder_id)
	for (const { id, value } of changed) {
		if (failed.has(id)) {
			clear_pending_entry_xattr(id, 'order', value)
			continue
		}
		// Keep the overlay until watch refreshes settle, as a single write does
		setTimeout(() => clear_pending_entry_xattr(id, 'order', value), 2000)
	}
	if (failed.size === 0) return !!store.folders[folder_id]

	// Show what the backend kept: the failed entries go back to their old order
	const current = store.folders[folder_id]
	if (current) {
		for (const id of failed) {
			const old = previous.get(id)
			const child = current.children?.find(c => c.id === id)
			if (!child) continue
			if (old === null || old === undefined) {
				child.xattrs = child.xattrs.filter(x => x.name !== 'order')
				continue
			}
			upsert_folder_xattr(current, id, 'order', old)
			sync_xattr_to_preview_folders(store.preview_folders, current, id, 'order', old)
		}
		current.children = sort_entries_by_order_then_name(current.children ?? [])
		sync_tree_from_folders(store)
	}
	return false
}

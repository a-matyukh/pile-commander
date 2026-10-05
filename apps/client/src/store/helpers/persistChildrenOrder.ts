import type { FolderWithChildrenXattrs, FileManager } from '@pile-commander/file-manager'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import { children_orders_match } from '@/services/workspace/folderContainer'
import { persist_xattr, upsert_folder_xattr, notify_children_reordered } from '@/services/workspace/xattrs'
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
	fm: Pick<FileManager, 'set_xattr'>,
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

	for (let index = 0; index < ordered_ids.length; index++) {
		const live = store.folders[folder_id] ?? folder_data
		upsert_folder_xattr(
			live,
			ordered_ids[index]!,
			'order',
			String(index),
		)
		const ok = await persist_xattr(
			fm,
			live,
			ordered_ids[index]!,
			'order',
			String(index),
			store.preview_folders,
			(error) => report_error(store, error),
			{
				resolve_folder: () => store.folders[folder_id],
				replace_folder: (next) => {
					store.folders[folder_id] = next
				},
			},
		)
		if (!ok) return false
	}

	const live = store.folders[folder_id]
	if (!live) return false

	const by_id = new Map((live.children ?? []).map(c => [c.id, c]))
	live.children = ordered_ids.map(id => by_id.get(id)!)
	notify_children_reordered(live)
	sync_tree_from_folders(store)

	return true
}

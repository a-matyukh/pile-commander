import type { FileManager, FolderChild, Xattr } from '@pile-commander/file-manager'
import { apply_entry_created, type WorkspaceState } from '@/services/workspace/mutations'
import { maybe_sync_tree_from_folders } from '@/services/workspace/batchFsUpdate'
import { report_error } from './reportError'

/**
 * Creates a file or folder together with its content and xattrs (one fs call,
 * so a watch refresh never sees the entry without its position) and registers
 * the new entry in the workspace state. Returns null when the fs operation fails.
 */
export async function create_entry(
	store: WorkspaceState & { last_error: string | null },
	fm: FileManager,
	folder_id: string,
	kind: 'file' | 'folder',
	name: string,
	options?: { content?: string; xattrs?: Xattr[] },
): Promise<FolderChild | null> {
	const xattrs = options?.xattrs ?? []
	const initial_xattrs = Object.fromEntries(xattrs.map(x => [x.name, x.value]))
	let node: FolderChild
	try {
		node = kind === 'folder'
			? await fm.create_folder(folder_id, name, { xattrs: initial_xattrs })
			: await fm.create_text_file(folder_id, name, {
				content: options?.content,
				xattrs: initial_xattrs,
			})
	} catch (error) {
		report_error(store, error)
		return null
	}

	apply_entry_created(store, folder_id, {
		id: node.id,
		name: node.name,
		type: node.type,
		xattrs: [...xattrs],
	})

	// Seed an empty cache for brand-new folders so the first move into them
	// does not race show_folder_children (disk reload) against optimistic
	// children / position writes — important for combine reactivity.
	// Copies/duplicates must NOT use this path: they need ensure_preview_folder
	// to load real children from disk.
	if (kind === 'folder' && !store.folders[node.id]) {
		store.folders[node.id] = {
			id: node.id,
			name: node.name,
			type: 'folder',
			xattrs: xattrs.map(x => ({ ...x })),
			children: [],
		}
		store.tree_loaded_folder_ids.add(node.id)
		maybe_sync_tree_from_folders(store)
	}

	return node
}

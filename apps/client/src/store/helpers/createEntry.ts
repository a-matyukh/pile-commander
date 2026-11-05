import type { FileManager, FolderChild, Xattr } from '@pile-commander/file-manager'
import { apply_entry_created, apply_entry_removed, apply_id_changed, type WorkspaceState } from '@/services/workspace/mutations'
import { hold_entry } from '@/services/cloud/pendingEntries'
import { maybe_sync_tree_from_folders } from '@/services/workspace/batchFsUpdate'
import { report_error } from './reportError'

/**
 * Creates a file or folder together with its content and xattrs (one fs call,
 * so a watch refresh never sees the entry without its position) and registers
 * the new entry in the workspace state. Returns null when the fs operation fails.
 *
 * `optimistic_id` (cloud: the path the entry will have): it is on screen at
 * once, its request holds every later call that names it
 * (`pendingEntries.ts`), and a refusal takes it away again and says why.
 * The returned promise still settles with the cloud's answer
 */
export async function create_entry(
	store: WorkspaceState & { last_error: string | null },
	fm: FileManager,
	folder_id: string,
	kind: 'file' | 'folder',
	name: string,
	options?: { content?: string; xattrs?: Xattr[]; optimistic_id?: string },
): Promise<FolderChild | null> {
	const xattrs = options?.xattrs ?? []
	const initial_xattrs = Object.fromEntries(xattrs.map(x => [x.name, x.value]))
	const optimistic = options?.optimistic_id
	if (optimistic) show_created(store, folder_id, kind, optimistic, name, xattrs)
	const request = kind === 'folder'
		? fm.create_folder(folder_id, name, { xattrs: initial_xattrs })
		: fm.create_text_file(folder_id, name, {
			content: options?.content,
			xattrs: initial_xattrs,
		})
	if (optimistic) hold_entry(fm, optimistic, request)
	let node: FolderChild
	try {
		node = await request
	} catch (error) {
		if (optimistic) apply_entry_removed(store, optimistic)
		report_error(store, error)
		return null
	}

	if (optimistic) {
		// the cloud named it otherwise (rare): the screen follows it
		if (node.id !== optimistic) apply_id_changed(store, optimistic, node.id, node.name)
		return node
	}
	show_created(store, folder_id, kind, node.id, node.name, xattrs)
	return node
}

function show_created(
	store: WorkspaceState,
	folder_id: string,
	kind: 'file' | 'folder',
	id: string,
	name: string,
	xattrs: Xattr[],
) {
	apply_entry_created(store, folder_id, {
		id,
		name,
		type: kind,
		xattrs: [...xattrs],
	})

	// Seed an empty cache for brand-new folders so the first move into them
	// does not race show_folder_children (disk reload) against optimistic
	// children / position writes — important for combine reactivity.
	// Copies/duplicates must NOT use this path: they need ensure_preview_folder
	// to load real children from disk.
	if (kind === 'folder' && !store.folders[id]) {
		store.folders[id] = {
			id,
			name,
			type: 'folder',
			xattrs: xattrs.map(x => ({ ...x })),
			children: [],
		}
		store.tree_loaded_folder_ids.add(id)
		maybe_sync_tree_from_folders(store)
	}
}

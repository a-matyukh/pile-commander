import type { EntryWithXattrs, FileManager, FolderChild } from '@pile-commander/file-manager'
import type { ImportProgress, WorkspaceStore } from '@/domain/Store'
import {
	apply_entry_created,
	apply_entry_removed,
	find_child_entry,
} from '@/services/workspace/mutations'
import { find_tree_node } from '@/services/workspace/tree'
import { parent_folder_id_from_node_id, path_separator } from '@/services/workspace/paths'
import { make_connection_id } from '@/services/canvas/connections'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import { read_entry_blob, upload_mime } from '@/services/workspace/entryBytes'
import { invalidate_entry_content_caches } from '@/ui/workspace/folder-container/textContentCache'
import { persist_children_order } from './persistChildrenOrder'
import {
	copy_folder_canvas_connections,
	move_folder_canvas_connections,
} from './persistCanvas'
import { report_error } from './reportError'

export type TransferOptions = {
	source_store: WorkspaceStore
	target_store: WorkspaceStore
	entry_ids: string[]
	/** Folder id in the TARGET store's coordinates. */
	target_folder_id: string
	/** 'move' removes each source entry after its copy lands. */
	mode: 'copy' | 'move'
	/**
	 * Skip the direct same-fm move/copy shortcut. Required for the desktop
	 * board FM: one store fronts many workspaces and cross-workspace calls
	 * are exactly what the backend forbids — every entry must go through
	 * the read→write path so each FM call stays inside one workspace.
	 */
	force_generic?: boolean
}

type EntryMeta = { id: string; name: string; type: 'file' | 'folder' }

/**
 * Cross-store (cross-workspace) transfer: the cloud backend forbids
 * cross-workspace move/copy RPCs, so entries are read through the source
 * store's file manager and recreated through the target's. Each individual
 * FM call stays within one workspace.
 *
 * Fast path (one fs/RPC call per entry, xattrs included):
 * - same workspace in two stores (e.g. two windows), or both stores local.
 *
 * Generic path: file = get_media_src → fetch → Blob → upload_file; folder =
 * create_folder + recursion. xattrs are copied verbatim via list/set — the
 * target folder has an independent coordinate space, so `position` carries
 * over unchanged (a FolderPreview drop may refine it via change_position;
 * a folder_cover drop leaves it alone like paste).
 */
export async function transfer_entries(options: TransferOptions): Promise<string[]> {
	const { source_store, target_store, entry_ids, target_folder_id, mode } = options
	const source_fm = source_store.file_manager
	const target_fm = target_store.file_manager

	let folder_data = target_store.resolve_folder_data(target_folder_id)
	if (!folder_data) {
		// target not cached (e.g. a desktop tile whose preview is off): load it
		// so the entries land visibly (and a preview drop's change_position finds them)
		await target_store.show_folder_children(target_folder_id)
		folder_data = target_store.resolve_folder_data(target_folder_id)
	}
	if (!folder_data) {
		report_error(target_store, new Error('Open a folder before pasting'))
		return []
	}

	const same_workspace = source_store.uid === target_store.uid
	const local_pair = source_store.type === 'local' && target_store.type === 'local'
	const direct = !options.force_generic && (same_workspace || local_pair)

	const existing_ids = (folder_data.children ?? []).map(c => c.id)
	const existing = new Set<string>((folder_data.children ?? []).map(c => c.name))
	const created_ids: string[] = []
	const created_entries: EntryWithXattrs[] = []
	// source id → created id, in each store's coordinates (edge clone below)
	const id_map = new Map<string, string>()

	const progress = (file_name: string, file_index: number): ImportProgress => ({
		file_name,
		file_index,
		total_files: entry_ids.length,
		loaded_bytes: 0,
		total_bytes: 0,
	})

	try {
		for (let index = 0; index < entry_ids.length; index++) {
			const id = entry_ids[index]!
			const meta = entry_meta(source_store, id)
			if (!meta) continue
			// copying a folder into itself/its subtree would recurse forever
			// (local windows can be rooted inside the source desktop folder)
			if (
				target_folder_id === id
				|| target_folder_id.startsWith(id + path_separator(id))
			) {
				continue
			}

			const name = resolve_unique_filename(meta.name, existing)
			existing.add(name)
			target_store.import_progress = progress(name, index + 1)
			const on_bytes = (loaded: number, total: number) => {
				if (target_store.import_progress) {
					target_store.import_progress.loaded_bytes = loaded
					target_store.import_progress.total_bytes = total
				}
			}

			let copied: EntryMeta
			let xattrs: EntryWithXattrs['xattrs'] = []
			// rename-based move already detached the source; every other path
			// must remove it after a successful copy
			let source_detached = false
			try {
				if (direct && mode === 'move') {
					try {
						const patch = await target_fm.move(id, target_folder_id, name)
						copied = { id: patch.id, name: patch.name, type: meta.type }
						source_detached = true
					} catch (error) {
						// cross-volume local moves (EXDEV) fall back to copy+remove
						if (!local_pair) throw error
						const child = await target_fm.copy_entry(id, target_folder_id, name)
						copied = { id: child.id, name: child.name, type: meta.type }
					}
					xattrs = await target_fm.list_xattrs(copied.id)
				} else if (direct) {
					const child = await target_fm.copy_entry(id, target_folder_id, name)
					copied = { id: child.id, name: child.name, type: meta.type }
					xattrs = await target_fm.list_xattrs(copied.id)
				} else {
					copied = await copy_recursive(source_fm, target_fm, id, target_folder_id, name, meta.type, on_bytes)
					xattrs = await target_fm.list_xattrs(copied.id)
				}
			} catch (error) {
				report_error(target_store, error)
				return created_ids
			}

			const entry: EntryWithXattrs = {
				id: copied.id,
				name: copied.name,
				type: copied.type,
				xattrs,
			}
		apply_entry_created(target_store, target_folder_id, entry)
		created_ids.push(copied.id)
		created_entries.push(entry)
		id_map.set(id, copied.id)

		if (mode === 'move') {
			if (!source_detached) {
				try {
					await source_fm.remove(id)
				} catch (error) {
					report_error(source_store, error)
					return created_ids
				}
			}
			invalidate_entry_content_caches(source_store.content_caches, id)
			apply_entry_removed(source_store, id)
			// Edges follow the entry across workspaces; when the other endpoint
			// is transferred too (this or a later batch), the heal re-attaches it.
			await move_folder_canvas_connections(
				source_store,
				target_store,
				id,
				copied.id,
				parent_folder_id_from_node_id(id, source_store.id),
				target_folder_id,
			)
		}
	}
	} finally {
		target_store.import_progress = null
	}

	if (created_ids.length === 0) return created_ids

	if (mode === 'copy') {
		// Edges between the copied entries live in the source folder's canvas —
		// clone them onto the copies so a connected pair stays connected.
		await copy_folder_canvas_connections(
			source_store,
			target_store,
			id_map,
			target_folder_id,
		)
	}

	await persist_children_order(target_store, target_fm, target_folder_id, [
		...existing_ids,
		...created_ids,
	])
	await target_store.prefetch_preview_folders(created_entries)

	return created_ids
}

function entry_meta(store: WorkspaceStore, id: string): EntryMeta | null {
	const node = find_tree_node(store.tree, id)
	const folder_entry = find_child_entry(store.folders, id)
	const name = node?.name ?? folder_entry?.name
	const type = node?.type ?? folder_entry?.type
	if (!name || !type) return null
	return { id, name, type }
}

/** Generic copy: read via source FM, recreate via target FM, xattrs verbatim. */
async function copy_recursive(
	source_fm: FileManager,
	target_fm: FileManager,
	source_id: string,
	target_folder_id: string,
	name: string,
	type: 'file' | 'folder',
	on_bytes: (loaded: number, total: number) => void,
	/** source id → target id for the whole copied subtree (endpoint remap). */
	id_map: Map<string, string> = new Map(),
): Promise<EntryMeta> {
	let child: FolderChild
	if (type === 'folder') {
		child = await target_fm.create_folder(target_folder_id, name)
	} else {
		const mime = upload_mime(name)
		const blob = await read_entry_blob(source_fm, source_id, name, mime)
		child = await target_fm.upload_file(target_folder_id, name, blob, mime, on_bytes)
	}
	id_map.set(source_id, child.id)

	const xattrs = await source_fm.list_xattrs(source_id)
	for (const attr of xattrs) {
		await target_fm.set_xattr(child.id, attr.name, attr.value)
	}

	if (type === 'folder') {
		// Folder ink travels with the folder. Fresh ids: stroke ids are the
		// table's global primary key, and the source rows still exist.
		// (Fast paths clone ink themselves: cloud copy_entry RPC, local .pile.)
		const strokes = await source_fm.strokes.list_strokes(source_id)
		if (strokes.length > 0) {
			await target_fm.strokes.upsert_strokes(
				child.id,
				strokes.map(stroke => ({ ...stroke, id: crypto.randomUUID() })),
			)
		}
		const children = await source_fm.FolderChildren(source_id)
		for (const sub of children) {
			// fresh folder: source children names are already unique inside it
			await copy_recursive(source_fm, target_fm, sub.id, child.id, sub.name, sub.type, on_bytes, id_map)
		}

		// Edges travel too: endpoints are remapped through the copy map and
		// the deterministic id (which embeds them) is recomputed. Edges with
		// an endpoint outside the copied subtree are dropped — same as the
		// copy_entry RPC's inner joins and the local sidecar rewrite.
		const connections = await source_fm.connections.list_connections(source_id)
		const remapped = connections.flatMap((connection) => {
			const from = id_map.get(connection.from)
			const to = id_map.get(connection.to)
			if (!from || !to) return []
			return [{
				...connection,
				from,
				to,
				id: make_connection_id(from, to, connection.from_handle, connection.to_handle),
			}]
		})
		if (remapped.length > 0) {
			await target_fm.connections.upsert_connections(child.id, remapped)
		}
	}

	return { id: child.id, name: child.name, type }
}

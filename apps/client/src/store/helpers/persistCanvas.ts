import type { Connection } from '@/domain/Widget'
import { make_connection_id, rename_connections } from '@/services/canvas/connections'
import { parent_folder_id_from_node_id, path_separator } from '@/services/workspace/paths'

/**
 * Store surface the connection helpers need. Entity-level: a rename is a
 * delete+insert (the deterministic connection id embeds endpoint paths),
 * a prune is a delete.
 */
export
type CanvasPersistStore = {
	last_error: string | null
	id: string
	/** Folder ids with a loaded connections cache. */
	connections_folder_ids(): string[]
	connections_for(folder_id: string): Connection[]
	/** Loads the folder's connections cache when the store supports it. */
	ensure_connections?(folder_id: string): Promise<void>
	upsert_connections(folder_id: string, connections: Connection[]): Promise<void>
	delete_connections(folder_id: string, connection_ids: string[]): Promise<void>
	/** Rekeys the connections cache for a renamed/moved folder subtree. */
	rekey_connections(old_id: string, new_id: string): void
}

/** Rewrites endpoints in every loaded folder affected by an id change. */
export async function rename_folder_canvas_connections(
	store: CanvasPersistStore,
	old_id: string,
	new_id: string,
	options?: { same_parent?: boolean },
): Promise<void> {
	if (old_id === new_id) return

	const old_parent = parent_folder_id_from_node_id(old_id, store.id)
	const new_parent = parent_folder_id_from_node_id(new_id, store.id)
	const same_parent = options?.same_parent ?? old_parent === new_parent

	// The renamed folder's own canvas travels under the new key; the fs
	// sidecar/table rows travel with the folder itself.
	store.rekey_connections(old_id, new_id)
	// Rekey drops the loaded flag and the old-path watcher — reload from
	// the new path (FM rebase / Finder-stale sidecar) before rewriting.
	await store.ensure_connections?.(new_id)
	const sep = path_separator(new_id)
	for (const folder_id of store.connections_folder_ids()) {
		if (folder_id !== new_id && folder_id.startsWith(new_id + sep)) {
			await store.ensure_connections?.(folder_id)
		}
	}

	const folder_ids = new Set<string>()
	if (same_parent) {
		// the parent's canvas references the renamed entry directly
		folder_ids.add(old_parent)
	}
	// the renamed folder's own canvas and its loaded subfolders: their
	// endpoints are paths inside the renamed subtree
	for (const folder_id of store.connections_folder_ids()) {
		if (folder_id === new_id || folder_id.startsWith(new_id + sep)) {
			folder_ids.add(folder_id)
		}
	}

	for (const folder_id of folder_ids) {
		const current = store.connections_for(folder_id)
		if (current.length === 0) continue
		const renamed = rename_connections(current, old_id, new_id)
		if (renamed === current) continue

		const old_ids: string[] = []
		const next: Connection[] = []
		for (let i = 0; i < current.length; i++) {
			if (renamed[i] !== current[i]) {
				old_ids.push(current[i]!.id)
				next.push(renamed[i]!)
			}
		}
		await store.delete_connections(folder_id, old_ids)
		await store.upsert_connections(folder_id, next)
	}
}

/**
 * Cross-folder move: connections follow the entry. Edges in the source folder
 * touching the moved entry relocate into the target folder with the endpoint
 * rewritten; the other endpoint may temporarily point outside the target —
 * it renders nowhere (same as an orphan edge) until that entry joins the same
 * folder, at which point the heal step re-attaches it. Running this for every
 * move keeps an edge alive when both endpoints are moved into one folder, in
 * any order.
 *
 * Source and target may be two different stores (cross-workspace transfer);
 * folder ids are then interpreted in each store's own coordinates.
 */
export async function move_folder_canvas_connections(
	source_store: CanvasPersistStore,
	target_store: CanvasPersistStore,
	old_id: string,
	new_id: string,
	source_folder_id: string,
	target_folder_id: string,
): Promise<void> {
	const same_folder =
		source_store === target_store && source_folder_id === target_folder_id
	if (same_folder || (source_store === target_store && old_id === new_id)) return

	// Both scans need the folders' edges in cache: an edge relocated by the
	// other endpoint's earlier move may be waiting in the target to re-attach.
	await source_store.ensure_connections?.(source_folder_id)
	await target_store.ensure_connections?.(target_folder_id)

	// Heal: edges relocated by an earlier move re-attach now that their other
	// endpoint has arrived in the target folder.
	const target = target_store.connections_for(target_folder_id)
	const healed = rename_connections(target, old_id, new_id)
	if (healed !== target) {
		const old_ids: string[] = []
		const next: Connection[] = []
		for (let i = 0; i < target.length; i++) {
			if (healed[i] !== target[i]) {
				old_ids.push(target[i]!.id)
				next.push(healed[i]!)
			}
		}
		await target_store.delete_connections(target_folder_id, old_ids)
		await target_store.upsert_connections(target_folder_id, next)
	}

	// Relocate: edges touching the moved entry leave the source folder.
	const moving = source_store
		.connections_for(source_folder_id)
		.filter(connection => connection.from === old_id || connection.to === old_id)
	if (moving.length === 0) return
	const relocated = rename_connections(moving, old_id, new_id)
	await source_store.delete_connections(source_folder_id, moving.map(connection => connection.id))
	await target_store.upsert_connections(target_folder_id, relocated)
}

/**
 * Copy/duplicate: clones edges whose BOTH endpoints were copied in the same
 * batch. An edge needs both ends — when only one endpoint is copied the edge
 * stays in the source only (copies have no lineage, so there is no heal).
 */
export async function copy_folder_canvas_connections(
	source_store: CanvasPersistStore,
	target_store: CanvasPersistStore,
	/** Copied entry id in source coordinates → created id in target coordinates. */
	id_map: Map<string, string>,
	target_folder_id: string,
): Promise<void> {
	if (id_map.size < 2) return

	// Edges live in the connections of their endpoints' parent folder — group
	// the copied ids by source folder (a batch usually shares one).
	const folders = new Map<string, Set<string>>()
	for (const old_id of id_map.keys()) {
		const parent = parent_folder_id_from_node_id(old_id, source_store.id)
		let ids = folders.get(parent)
		if (!ids) {
			ids = new Set()
			folders.set(parent, ids)
		}
		ids.add(old_id)
	}

	await target_store.ensure_connections?.(target_folder_id)

	for (const [source_folder_id, ids] of folders) {
		if (ids.size < 2) continue
		await source_store.ensure_connections?.(source_folder_id)
		const clones = source_store
			.connections_for(source_folder_id)
			.filter(connection => ids.has(connection.from) && ids.has(connection.to))
			.map((connection) => {
				const from = id_map.get(connection.from)!
				const to = id_map.get(connection.to)!
				return {
					...connection,
					from,
					to,
					id: make_connection_id(from, to, connection.from_handle, connection.to_handle),
				}
			})
		if (clones.length === 0) continue
		await target_store.upsert_connections(target_folder_id, clones)
	}
}

/** Drops connections touching removed entries from the folder's canvas. */
export async function prune_folder_canvas_connections(
	store: CanvasPersistStore,
	folder_id: string,
	removed_ids: string[],
): Promise<void> {
	if (removed_ids.length === 0) return

	const removed = new Set(removed_ids)
	const doomed = store.connections_for(folder_id)
		.filter(connection => removed.has(connection.from) || removed.has(connection.to))
	if (doomed.length === 0) return

	await store.delete_connections(folder_id, doomed.map(connection => connection.id))
}

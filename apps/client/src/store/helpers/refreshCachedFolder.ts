import { toRaw } from 'vue'
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

type ReadOrder = { next: number; applied: Map<string, number> }
const read_orders = new WeakMap<object, ReadOrder>()

/**
 * The order of one folder's reads in one store. A ticket is taken when the
 * read starts; its answer applies only if no read that started later has
 * applied already, so a slow old answer cannot put an older folder back.
 * Per store, not per path: two open roots both have `/`.
 */
export function folder_read_ticket(store: object, folder_id: string) {
	const key = toRaw(store)
	let order = read_orders.get(key)
	if (!order) {
		order = { next: 0, applied: new Map() }
		read_orders.set(key, order)
	}
	const ticket = ++order.next
	const own = order
	return {
		/** No later read of this folder has applied */
		is_latest: () => (own.applied.get(folder_id) ?? 0) < ticket,
		/** This answer is on screen now (a "not found" too) */
		applied: () => {
			if ((own.applied.get(folder_id) ?? 0) < ticket) own.applied.set(folder_id, ticket)
		},
	}
}

export type FolderReadTicket = ReturnType<typeof folder_read_ticket>

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
 * Preview and most editors save by writing a new file and renaming it over
 * the old one, which drops the file's xattrs: the card loses its position,
 * size and order. When the bytes of a file changed, the keys it lost were
 * lost, not removed — the app removes a key as a metadata-only change — so
 * the cached values are kept in the snapshot and written back to the file.
 * Keys it still has (or got again meanwhile) are left as they are.
 */
function restore_layout_lost_on_save(
	fm: FileManager,
	previous_children: readonly FolderWithChildrenXattrs['children'][number][],
	folder_data: FolderWithChildrenXattrs,
	event: WatchEvent,
): void {
	const content_event = (event.kind === 'modify' || event.kind === 'create' || event.kind === 'rename')
		&& event.content_changed !== false
	if (!content_event) return
	const before = new Map(previous_children.map(child => [child.id, child]))
	const restored: { id: string; xattrs: Record<string, string> }[] = []
	for (const child of folder_data.children ?? []) {
		const previous = before.get(child.id)
		if (child.type !== 'file' || !previous) continue
		const present = new Set(child.xattrs.map(xattr => xattr.name))
		const lost = previous.xattrs.filter(xattr => !present.has(xattr.name))
		if (lost.length === 0) continue
		child.xattrs = [...child.xattrs, ...lost.map(xattr => ({ ...xattr }))]
		restored.push({ id: child.id, xattrs: Object.fromEntries(lost.map(({ name, value }) => [name, value])) })
	}
	if (restored.length === 0) return
	void fm.set_xattrs(restored).catch((error: unknown) => {
		console.error('[workspace] could not restore the layout of a file saved elsewhere', error)
	})
}

/**
 * Re-fetches a cached folder from disk, replaces the cache entry and
 * refreshes the projected tree; cleans up disappeared entries.
 *
 * Retries when a local xattr write bumps the folder cache generation during
 * the fetch — otherwise a stale snapshot can overwrite an optimistic update
 * (e.g. folder view switch appears to do nothing until the folder is re-opened).
 *
 * Resolves 'gone' when the open folder itself no longer exists.
 */
export async function refresh_cached_folder(
	store: WorkspaceState & CanvasPersistStore & { content_caches: EntryContentCaches },
	fm: FileManager,
	folder_id: string,
	event: WatchEvent,
	/** A read of this folder already in flight, with the ticket taken when it started: the first attempt uses it */
	started?: { read: Promise<FolderWithChildrenXattrs>; ticket: FolderReadTicket },
): Promise<'gone' | void> {
	for (let attempt = 0; attempt < 3; attempt++) {
		if (!store.folders[folder_id]) return

		const generation_at_start = folder_cache_generation(folder_id)
		const previous_children = store.folders[folder_id]!.children ?? []
		const old_child_ids = new Set(previous_children.map(c => c.id))
		const reuse = attempt === 0 ? started : undefined
		const ticket = reuse?.ticket ?? folder_read_ticket(store, folder_id)

		let folder_data: FolderWithChildrenXattrs
		try {
			folder_data = await (reuse?.read ?? fm.folder_with_children_xattrs(folder_id))
		} catch (error) {
			// A later read already answered: this failure is old news
			if (!ticket.is_latest()) return
			// Nested preview folders often linger in `store.folders` until the
			// watch refresh runs; once deleted they must be dropped quietly.
			if (
				is_missing_path_error(error)
				&& folder_id !== store.id
				&& store.opened_folder_id !== folder_id
			) {
				ticket.applied()
				invalidate_entry_content_caches(store.content_caches, folder_id)
				apply_entry_removed(store, folder_id)
				return
			}
			// The open folder itself was just deleted: whoever deleted it moves
			// the view on (the Explorer opens the parent). Nothing to report
			if (is_missing_path_error(error) && store.opened_folder_id === folder_id) {
				ticket.applied()
				return 'gone'
			}
			report_error(store, error)
			return
		}

		if (!store.folders[folder_id]) return
		// A read that started later has applied: this older snapshot must not replace it
		if (!ticket.is_latest()) return

		if (folder_cache_generation(folder_id) !== generation_at_start) {
			continue
		}
		ticket.applied()

		// look writes keep their overlay per workspace: `/` of another root is not this one
		apply_pending_entry_xattrs(folder_data, (store as { uid?: string }).uid)
		restore_layout_lost_on_save(fm, previous_children, folder_data, event)

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

/**
 * The event for reading a folder again after it was shown from what was
 * kept (memory or this device). It only reads: a key the kept copy has and
 * the cloud does not is gone, not lost, so nothing is written back
 * (`content_changed: false` skips `restore_layout_lost_on_save`)
 */
export function reread_event(folder_id: string): WatchEvent {
	return { kind: 'modify', ids: [folder_id], content_changed: false }
}

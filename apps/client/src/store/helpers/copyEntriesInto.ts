import type { EntryWithXattrs, FileManager, FolderWithChildrenXattrs, Xattr } from '@pile-commander/file-manager'
import {
	apply_entry_created,
	find_child_entry,
	type WorkspaceState,
} from '@/services/workspace/mutations'
import { find_tree_node, is_descendant } from '@/services/workspace/tree'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import { persist_children_order } from './persistChildrenOrder'
import { copy_folder_canvas_connections, type CanvasPersistStore } from './persistCanvas'
import { report_error } from './reportError'

/** Diagonal nudge so a same-folder duplicate is not stacked on the original. */
export const COPY_POSITION_OFFSET = 24

type CopyEntriesStore = WorkspaceState & {
	last_error: string | null
	id: string
	tree_loaded_folder_ids: Set<string>
	opened_folder: FolderWithChildrenXattrs
	preview_folders: Record<string, FolderWithChildrenXattrs>
	resolve_folder_data(folder_id: string): FolderWithChildrenXattrs | null
	prefetch_preview_folders(entries: FolderWithChildrenXattrs['children']): Promise<void>
}

function offset_position_xattrs(xattrs: Xattr[]): Xattr[] {
	return xattrs.map(attr => {
		if (attr.name !== 'position') return attr
		try {
			const parsed = JSON.parse(attr.value) as { x?: unknown; y?: unknown }
			if (typeof parsed.x !== 'number' || typeof parsed.y !== 'number') return attr
			return {
				name: 'position',
				value: JSON.stringify({
					x: parsed.x + COPY_POSITION_OFFSET,
					y: parsed.y + COPY_POSITION_OFFSET,
				}),
			}
		} catch {
			return attr
		}
	})
}

/**
 * Copies entries into `target_folder_id` with unique names and appends them
 * to the children order. Returns created ids (empty when nothing was copied).
 * When a copied entry has a `position` xattr, it is nudged so duplicates do not stack.
 */
export async function copy_entries_into(
	store: CopyEntriesStore & CanvasPersistStore,
	fm: FileManager,
	target_folder_id: string,
	entry_ids: string[],
): Promise<string[]> {
	const folder_data = store.resolve_folder_data(target_folder_id)
	if (!folder_data) {
		report_error(store, new Error('Open a folder before pasting'))
		return []
	}

	const existing_ids = (folder_data.children ?? []).map(c => c.id)
	const existing = new Set<string>((folder_data.children ?? []).map(c => c.name))
	const created_ids: string[] = []
	const created_entries: EntryWithXattrs[] = []
	// copied id → created id, for the edge clone below
	const id_map = new Map<string, string>()

	for (const id of entry_ids) {
		if (target_folder_id === id || is_descendant(store.tree, id, target_folder_id)) {
			continue
		}

		const node = find_tree_node(store.tree, id)
		const folder_entry = find_child_entry(store.folders, id)
		const base_name = node?.name ?? folder_entry?.name
		if (!base_name) continue

		const name = resolve_unique_filename(base_name, existing)
		existing.add(name)

		let copied
		try {
			copied = await fm.copy_entry(id, target_folder_id, name)
		} catch (error) {
			report_error(store, error)
			return created_ids
		}

		let xattrs: Xattr[] = []
		try {
			xattrs = await fm.list_xattrs(copied.id)
		} catch (error) {
			report_error(store, error)
		}

		xattrs = offset_position_xattrs(xattrs)
		const position = xattrs.find(a => a.name === 'position')
		if (position) {
			try {
				await fm.set_xattr(copied.id, 'position', position.value)
			} catch (error) {
				report_error(store, error)
			}
		}

		const entry: EntryWithXattrs = {
			id: copied.id,
			name: copied.name,
			type: copied.type,
			xattrs,
		}
		apply_entry_created(store, target_folder_id, entry)
		created_ids.push(copied.id)
		created_entries.push(entry)
		id_map.set(id, copied.id)
	}

	if (created_ids.length === 0) return created_ids

	// Edges between the copied entries live in the source folder's canvas —
	// clone them onto the copies so a connected pair stays connected.
	await copy_folder_canvas_connections(store, store, id_map, target_folder_id)

	await persist_children_order(store, fm, target_folder_id, [
		...existing_ids,
		...created_ids,
	])

	await store.prefetch_preview_folders(created_entries)

	return created_ids
}

import type { EntryWithXattrs, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { find_entry_owner_folder, xattrs_map } from './xattrs'

function pick<T extends Record<string, unknown>>(obj: T, keys: (keyof T)[]): Partial<T> {
	const result: Partial<T> = {}
	for (const key of keys) {
		if (key in obj && obj[key] !== undefined) {
			result[key] = obj[key]
		}
	}
	return result
}

function order_from_attrs(attrs: Record<string, unknown>): number | undefined {
	const order = attrs.order
	return typeof order === 'number' ? order : undefined
}

export function entry_is_preview(entry: EntryWithXattrs): boolean {
	return xattrs_map(entry.xattrs).is_preview === true
}

export function entry_order(entry: EntryWithXattrs): number | undefined {
	return order_from_attrs(xattrs_map(entry.xattrs))
}

export function collect_preview_folder_ids(entries: EntryWithXattrs[]): string[] {
	const ids: string[] = []
	for (const entry of entries) {
		if (entry.type === 'folder' && entry_is_preview(entry)) {
			ids.push(entry.id)
		}
	}
	return ids
}

function child_from_entry(
	entry: EntryWithXattrs,
	attrs: Record<string, unknown>,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
): FolderContainerWidgetChild {
	const base = {
		id: entry.id,
		name: entry.name,
		...pick(attrs, ['position', 'size', 'background', 'is_preview', 'order']),
	}

	if (entry.type === 'file') {
		return {
			...base,
			type: 'file',
			...pick(attrs, ['padding', 'cover', 'model_camera']),
		}
	}

	if (attrs.is_preview === true && preview_folders?.[entry.id]) {
		const container = to_folder_container(preview_folders[entry.id]!, preview_folders)
		// Board placement (position/size) lives on the parent folder's child entry,
		// not on the nested folder's own xattrs.
		return {
			...container,
			...pick(attrs, ['position', 'size', 'background', 'order', 'is_preview']),
		}
	}

	return {
		id: entry.id,
		name: entry.name,
		...pick(attrs, ['position', 'size', 'is_preview', 'order', 'cover']),
		type: 'folder_cover',
	}
}

export function children_orders_match(
	children: EntryWithXattrs[] | undefined,
	ordered_ids: string[],
): boolean {
	if (!children || children.length !== ordered_ids.length) {
		return false
	}

	const order_by_id = new Map<string, number | undefined>()
	for (const child of children) {
		order_by_id.set(child.id, entry_order(child))
	}

	for (let index = 0; index < ordered_ids.length; index++) {
		const id = ordered_ids[index]!
		if (!order_by_id.has(id) || order_by_id.get(id) !== index) {
			return false
		}
	}

	return true
}

export function sort_entries_by_order_then_name<T extends EntryWithXattrs>(entries: T[]): T[] {
	const order_by_id = new Map<string, number | undefined>()
	for (const entry of entries) {
		order_by_id.set(entry.id, entry_order(entry))
	}

	return [...entries].sort((a, b) => {
		const ao = order_by_id.get(a.id)
		const bo = order_by_id.get(b.id)
		if (ao === undefined && bo === undefined) return a.name.localeCompare(b.name)
		if (ao === undefined) return 1
		if (bo === undefined) return -1
		return ao! - bo!
	})
}

export function to_folder_container(
	folder: FolderWithChildrenXattrs,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
): FolderContainerWidget {
	const attrs = xattrs_map(folder.xattrs)
	const view = (attrs.view as FolderContainerWidget['view']) ?? 'list'

	const raw_children = folder.children ?? []
	const attrs_by_id = new Map<string, Record<string, unknown>>()
	for (const entry of raw_children) {
		attrs_by_id.set(entry.id, xattrs_map(entry.xattrs))
	}

	const children = [...raw_children]
		.sort((a, b) => {
			const ao = order_from_attrs(attrs_by_id.get(a.id)!)
			const bo = order_from_attrs(attrs_by_id.get(b.id)!)
			if (ao === undefined && bo === undefined) return a.name.localeCompare(b.name)
			if (ao === undefined) return 1
			if (bo === undefined) return -1
			return ao - bo
		})
		.map(entry => child_from_entry(entry, attrs_by_id.get(entry.id)!, preview_folders))

	return {
		id: folder.id,
		name: folder.name,
		type: 'folder_container',
		view,
		...pick(attrs, ['position', 'size', 'background', 'is_preview', 'order', 'snap_to_grid', 'grid_size', 'show_grid_dots', 'show_axes', 'selected_slide_index']),
		children,
	}
}

/** Embedded preview: fresh folder data + live placement attrs from parent entry. */
export function resolve_embedded_folder_container(
	opened_folder: FolderWithChildrenXattrs,
	preview_folders: Record<string, FolderWithChildrenXattrs>,
	folder_id: string,
): FolderContainerWidget | null {
	const folder_data = opened_folder.id === folder_id
		? opened_folder
		: preview_folders[folder_id] ?? null
	if (!folder_data) {
		return null
	}

	const fresh = to_folder_container(folder_data, preview_folders)
	const owner = find_entry_owner_folder(opened_folder, preview_folders, folder_id)
	const entry = owner?.children?.find(c => c.id === folder_id)
	if (!entry) {
		return fresh
	}

	const entry_attrs = xattrs_map(entry.xattrs)
	return {
		...fresh,
		...pick(entry_attrs, ['position', 'size', 'background', 'order', 'is_preview']),
	}
}

export function find_widget_in_container(
	container: FolderContainerWidget,
	widget_id: string,
): FolderContainerWidgetChild | FolderContainerWidget | undefined {
	if (container.id === widget_id) {
		return container
	}

	for (const child of container.children) {
		if (child.id === widget_id) {
			return child
		}
		if (child.type === 'folder_container') {
			const nested = find_widget_in_container(child, widget_id)
			if (nested) return nested
		}
	}

	return undefined
}

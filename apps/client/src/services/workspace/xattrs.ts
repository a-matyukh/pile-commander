import type { FileManager, FolderWithChildrenXattrs, Xattr } from '@pile-commander/file-manager'

export function parse_xattr_value(value: string): unknown {
	if (value === 'true') return true
	if (value === 'false') return false
	const num = Number(value)
	if (value !== '' && !Number.isNaN(num)) return num
	try {
		return JSON.parse(value)
	} catch {
		return value
	}
}

export function xattrs_map(xattrs: Xattr[]): Record<string, unknown> {
	const map: Record<string, unknown> = {}
	for (const { name, value } of xattrs) {
		map[name] = parse_xattr_value(value)
	}
	return map
}

function upsert_xattr(xattrs: Xattr[], name: string, value: string) {
	const xattr = xattrs.find(x => x.name === name)
	if (xattr) xattr.value = value
	else xattrs.push({ name, value })
}

export function upsert_folder_xattr(
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string,
) {
	if (folder.id === id) {
		upsert_xattr(folder.xattrs, name, value)
		return
	}

	const child = folder.children?.find(c => c.id === id)
	if (child) {
		upsert_xattr(child.xattrs, name, value)
	}
}

/** Shallow-touch children list after reorder. */
export function notify_children_reordered(folder: FolderWithChildrenXattrs) {
	folder.children = [...(folder.children ?? [])]
}

/** Shallow-touch entry so Vue picks up in-place xattr mutations. */
export function notify_entry_xattr_changed(
	folder: FolderWithChildrenXattrs,
	id: string,
) {
	if (folder.id === id) {
		folder.xattrs = [...folder.xattrs]
		return
	}

	if (!folder.children) return

	const index = folder.children.findIndex(c => c.id === id)
	if (index === -1) return

	const child = folder.children[index]!
	folder.children[index] = { ...child, xattrs: [...child.xattrs] }
	folder.children = [...folder.children]
}

export function sync_xattr_to_preview_folders(
	preview_folders: Record<string, FolderWithChildrenXattrs>,
	source_folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string,
) {
	for (const folder of Object.values(preview_folders)) {
		const had_child = folder.children?.some(c => c.id === id) ?? false
		upsert_folder_xattr(folder, id, name, value)
		if (had_child) {
			notify_entry_xattr_changed(folder, id)
		}
	}

	// Root attrs of a cached preview folder (view, grid, etc.) — not child placement.
	if (source_folder.id === id && preview_folders[id]) {
		upsert_folder_xattr(preview_folders[id], id, name, value)
		notify_entry_xattr_changed(preview_folders[id], id)
	}
}

/** Bumped around local xattr writes so in-flight watch refreshes discard stale snapshots. */
const folder_cache_generations = new Map<string, number>()

/**
 * Local xattr writes that must win over a watch refresh that still reads a
 * pre-write snapshot from disk (common with directory xattr FSEvents).
 * Keyed by entry id → xattr name → value.
 */
const pending_entry_xattrs = new Map<string, Map<string, string>>()

export function folder_cache_generation(folder_id: string): number {
	return folder_cache_generations.get(folder_id) ?? 0
}

export function bump_folder_cache_generation(folder_id: string): number {
	const next = folder_cache_generation(folder_id) + 1
	folder_cache_generations.set(folder_id, next)
	return next
}

export function set_pending_entry_xattr(entry_id: string, name: string, value: string) {
	let attrs = pending_entry_xattrs.get(entry_id)
	if (!attrs) {
		attrs = new Map()
		pending_entry_xattrs.set(entry_id, attrs)
	}
	attrs.set(name, value)
}

export function clear_pending_entry_xattr(entry_id: string, name: string, value?: string) {
	const attrs = pending_entry_xattrs.get(entry_id)
	if (!attrs) return
	if (value !== undefined && attrs.get(name) !== value) return
	attrs.delete(name)
	if (attrs.size === 0) {
		pending_entry_xattrs.delete(entry_id)
	}
}

/** Keep in-flight xattr overlays attached after rename/move path changes. */
export function rekey_pending_entry_xattrs(old_id: string, new_id: string) {
	if (old_id === new_id) return
	const pending = pending_entry_xattrs.get(old_id)
	if (!pending) return
	pending_entry_xattrs.delete(old_id)
	const existing = pending_entry_xattrs.get(new_id)
	if (!existing) {
		pending_entry_xattrs.set(new_id, pending)
		return
	}
	for (const [name, value] of pending) {
		existing.set(name, value)
	}
}

/** Re-apply in-flight local writes onto a freshly fetched folder snapshot. */
export function apply_pending_entry_xattrs(folder: FolderWithChildrenXattrs) {
	const root_pending = pending_entry_xattrs.get(folder.id)
	if (root_pending) {
		for (const [name, value] of root_pending) {
			upsert_xattr(folder.xattrs, name, value)
		}
	}

	for (const child of folder.children ?? []) {
		const pending = pending_entry_xattrs.get(child.id)
		if (!pending) continue
		for (const [name, value] of pending) {
			upsert_xattr(child.xattrs, name, value)
		}
	}
}

function clone_folder_for_cache(folder: FolderWithChildrenXattrs): FolderWithChildrenXattrs {
	return {
		...folder,
		xattrs: folder.xattrs.map(x => ({ ...x })),
		children: folder.children?.map(child => ({
			...child,
			xattrs: child.xattrs.map(x => ({ ...x })),
		})),
	}
}

function apply_persisted_xattr(
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
) {
	upsert_folder_xattr(folder, id, name, value)
	notify_entry_xattr_changed(folder, id)
	if (preview_folders) {
		sync_xattr_to_preview_folders(preview_folders, folder, id, name, value)
	}
}

export type PersistXattrHooks = {
	/** Live cache lookup after await (avoid mutating an orphaned folder object). */
	resolve_folder?: () => FolderWithChildrenXattrs | null | undefined
	/**
	 * Replace the live cache entry with a new object identity.
	 * Needed so Vue recomputes views that only tracked `folders[id]`.
	 */
	replace_folder?: (folder: FolderWithChildrenXattrs) => void
}

export async function persist_xattr(
	fm: Pick<FileManager, 'set_xattr'>,
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
	on_error?: (error: unknown) => void,
	resolve_folder_or_hooks?: (() => FolderWithChildrenXattrs | null | undefined) | PersistXattrHooks,
): Promise<boolean> {
	const hooks: PersistXattrHooks = typeof resolve_folder_or_hooks === 'function'
		? { resolve_folder: resolve_folder_or_hooks }
		: (resolve_folder_or_hooks ?? {})

	const owner_id = folder.id
	// Invalidate refreshes that started before this write (they may still hold a pre-write read).
	bump_folder_cache_generation(owner_id)
	set_pending_entry_xattr(id, name, value)

	try {
		await fm.set_xattr(id, name, value)
	} catch (error) {
		bump_folder_cache_generation(owner_id)
		clear_pending_entry_xattr(id, name, value)
		on_error?.(error)
		return false
	}

	// Invalidate refreshes that raced during the write and may have read a stale snapshot.
	bump_folder_cache_generation(owner_id)

	const target = hooks.resolve_folder?.() ?? folder
	if (target) {
		apply_persisted_xattr(target, id, name, value, preview_folders)
		// New object identity — same trigger path as open_folder / watch refresh.
		hooks.replace_folder?.(clone_folder_for_cache(target))
	}

	// Keep the overlay until watch refreshes settle; then drop if still current.
	const pending_value = value
	setTimeout(() => {
		clear_pending_entry_xattr(id, name, pending_value)
	}, 2000)

	return true
}

export function find_entry_owner_folder(
	opened_folder: FolderWithChildrenXattrs,
	preview_folders: Record<string, FolderWithChildrenXattrs>,
	widget_id: string,
): FolderWithChildrenXattrs | null {
	if (opened_folder.id === widget_id || opened_folder.children?.some(c => c.id === widget_id)) {
		return opened_folder
	}

	for (const folder of Object.values(preview_folders)) {
		if (folder.id === widget_id || folder.children?.some(c => c.id === widget_id)) {
			return folder
		}
	}

	return null
}

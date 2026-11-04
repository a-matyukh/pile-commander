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

function drop_xattr(xattrs: Xattr[], name: string) {
	const index = xattrs.findIndex(x => x.name === name)
	if (index !== -1) xattrs.splice(index, 1)
}

/** Pending value that means "this name was removed" until the watch refresh settles. */
const PENDING_XATTR_REMOVED = '\0'

function apply_pending_value(xattrs: Xattr[], name: string, value: string) {
	if (value === PENDING_XATTR_REMOVED) drop_xattr(xattrs, name)
	else upsert_xattr(xattrs, name, value)
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

function drop_folder_xattr(
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
) {
	if (folder.id === id) {
		drop_xattr(folder.xattrs, name)
		return
	}

	const child = folder.children?.find(c => c.id === id)
	if (child) drop_xattr(child.xattrs, name)
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

/**
 * The overlay key: a look write passes its workspace (`scope`), so a pending
 * value on `/` of one root never lands on `/` of another open root. Older
 * writes pass none (the path alone, as before)
 */
function pending_key(entry_id: string, scope?: string): string {
	return scope ? `${scope}\0${entry_id}` : entry_id
}

export function set_pending_entry_xattr(entry_id: string, name: string, value: string, scope?: string) {
	const key = pending_key(entry_id, scope)
	let attrs = pending_entry_xattrs.get(key)
	if (!attrs) {
		attrs = new Map()
		pending_entry_xattrs.set(key, attrs)
	}
	attrs.set(name, value)
}

export function clear_pending_entry_xattr(entry_id: string, name: string, value?: string, scope?: string) {
	const key = pending_key(entry_id, scope)
	const attrs = pending_entry_xattrs.get(key)
	if (!attrs) return
	if (value !== undefined && attrs.get(name) !== value) return
	attrs.delete(name)
	if (attrs.size === 0) {
		pending_entry_xattrs.delete(key)
	}
}

/** Keep in-flight xattr overlays attached after rename/move path changes (in every workspace scope). */
export function rekey_pending_entry_xattrs(old_id: string, new_id: string) {
	if (old_id === new_id) return
	for (const key of [...pending_entry_xattrs.keys()]) {
		const scoped = key.endsWith(`\0${old_id}`)
		if (key !== old_id && !scoped) continue
		const next_key = scoped ? `${key.slice(0, key.length - old_id.length)}${new_id}` : new_id
		const pending = pending_entry_xattrs.get(key)!
		pending_entry_xattrs.delete(key)
		const existing = pending_entry_xattrs.get(next_key)
		if (!existing) {
			pending_entry_xattrs.set(next_key, pending)
			continue
		}
		for (const [name, value] of pending) existing.set(name, value)
	}
}

/** Re-apply in-flight local writes onto a freshly fetched folder snapshot (`scope`: its workspace). */
export function apply_pending_entry_xattrs(folder: FolderWithChildrenXattrs, scope?: string) {
	const apply = (entry_id: string, xattrs: FolderWithChildrenXattrs['xattrs']) => {
		for (const key of scope ? [entry_id, pending_key(entry_id, scope)] : [entry_id]) {
			const pending = pending_entry_xattrs.get(key)
			if (!pending) continue
			for (const [name, value] of pending) apply_pending_value(xattrs, name, value)
		}
	}
	apply(folder.id, folder.xattrs)
	for (const child of folder.children ?? []) apply(child.id, child.xattrs)
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

function sync_xattr_drop_to_preview_folders(
	preview_folders: Record<string, FolderWithChildrenXattrs>,
	source_folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
) {
	for (const folder of Object.values(preview_folders)) {
		const had_child = folder.children?.some(c => c.id === id) ?? false
		drop_folder_xattr(folder, id, name)
		if (had_child) notify_entry_xattr_changed(folder, id)
	}

	if (source_folder.id === id && preview_folders[id]) {
		drop_folder_xattr(preview_folders[id], id, name)
		notify_entry_xattr_changed(preview_folders[id], id)
	}
}

function apply_cleared_xattr(
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
) {
	drop_folder_xattr(folder, id, name)
	notify_entry_xattr_changed(folder, id)
	if (preview_folders) {
		sync_xattr_drop_to_preview_folders(preview_folders, folder, id, name)
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

/** Remove one xattr. A tombstone in the pending map keeps a stale refresh from putting it back. */
export async function clear_xattr(
	fm: Pick<FileManager, 'remove_xattr'>,
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
	on_error?: (error: unknown) => void,
	resolve_folder_or_hooks?: (() => FolderWithChildrenXattrs | null | undefined) | PersistXattrHooks,
): Promise<boolean> {
	const hooks: PersistXattrHooks = typeof resolve_folder_or_hooks === 'function'
		? { resolve_folder: resolve_folder_or_hooks }
		: (resolve_folder_or_hooks ?? {})

	const owner_id = folder.id
	bump_folder_cache_generation(owner_id)
	set_pending_entry_xattr(id, name, PENDING_XATTR_REMOVED)

	try {
		await fm.remove_xattr(id, name)
	} catch (error) {
		bump_folder_cache_generation(owner_id)
		clear_pending_entry_xattr(id, name, PENDING_XATTR_REMOVED)
		on_error?.(error)
		return false
	}

	bump_folder_cache_generation(owner_id)

	const target = hooks.resolve_folder?.() ?? folder
	if (target) {
		apply_cleared_xattr(target, id, name, preview_folders)
		hooks.replace_folder?.(clone_folder_for_cache(target))
	}

	setTimeout(() => {
		clear_pending_entry_xattr(id, name, PENDING_XATTR_REMOVED)
	}, 2000)

	return true
}

/** Shows one attribute value on a cached folder (`null`: not set), as a write that succeeded would */
export function show_xattr_locally(
	folder: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string | null,
	preview_folders?: Record<string, FolderWithChildrenXattrs>,
	hooks?: PersistXattrHooks,
) {
	const target = hooks?.resolve_folder?.() ?? folder
	if (!target) return
	if (value === null) apply_cleared_xattr(target, id, name, preview_folders)
	else apply_persisted_xattr(target, id, name, value, preview_folders)
	hooks?.replace_folder?.(clone_folder_for_cache(target))
}

type LookWrite = {
	/** The value the backend has, as far as this client knows */
	confirmed: string | null
	/** The value on screen, to be written */
	wanted: string | null
	/** Bumped by every change: a write that finds it moved lets the newer value go next */
	version: number
	options: WriteNowOptions
	running?: Promise<void>
}

/** Per file manager (one per workspace store), by entry id and attribute */
const look_writes = new WeakMap<object, Map<string, LookWrite>>()
let unsaved_writes = 0

/** A look change or a picture upload has not reached the backend yet (closing now would lose it) */
export function has_unsaved_writes(): boolean {
	return unsaved_writes > 0
}

/** Counts work that must finish before the window closes; the returned function ends it once */
export function track_unsaved_write(): () => void {
	unsaved_writes += 1
	let open = true
	return () => {
		if (!open) return
		open = false
		unsaved_writes -= 1
	}
}

export type WriteNowOptions = {
	/** The workspace: the pending overlay is kept per workspace (see pending_key) */
	scope?: string
	/** The attribute's value before this change (null: not set) */
	previous: string | null
	/** Puts a value on screen wherever the attribute shows; a rollback goes through it too */
	show(value: string | null): void
	/** The attribute as the backend has it, after a failed write */
	reread(): Promise<string | null>
	on_error(error: unknown): void
	/**
	 * Write only once this resolves true (a picture's upload: the attribute
	 * must never name a file that is not there). False: put the last saved
	 * value back without writing; the upload reported its own error
	 */
	after?: Promise<boolean>
}

/**
 * A folder's look (view, icon, cover, background) changes on screen at once;
 * the write goes in the background, one at a time per attribute, newest value
 * last (the server does not order concurrent merges). A failed write that no
 * newer change has replaced shows what the backend really has: re-read (the
 * answer may have been lost after the save), or the last saved value when
 * even that fails. Resolves once the attribute has settled.
 */
export function persist_xattr_now(
	fm: Pick<FileManager, 'set_xattr' | 'remove_xattr'>,
	owner_id: string,
	id: string,
	name: string,
	value: string | null,
	options: WriteNowOptions,
): Promise<void> {
	let writes = look_writes.get(fm)
	if (!writes) {
		writes = new Map()
		look_writes.set(fm, writes)
	}
	const key = `${id}\0${name}`
	let entry = writes.get(key)
	if (!entry) {
		entry = { confirmed: options.previous, wanted: value, version: 0, options }
		writes.set(key, entry)
	}
	entry.wanted = value
	entry.version += 1
	entry.options = options

	// a refresh that started before this change must not put the old value back
	bump_folder_cache_generation(owner_id)
	set_pending_entry_xattr(id, name, value ?? PENDING_XATTR_REMOVED, options.scope)
	options.show(value)
	if (entry.running) return entry.running

	const own = entry
	const all = writes
	const done = track_unsaved_write()
	const put_back = (shown: string | null) => {
		own.wanted = shown
		set_pending_entry_xattr(id, name, shown ?? PENDING_XATTR_REMOVED, own.options.scope)
		own.options.show(shown)
	}
	own.running = (async () => {
		try {
			for (;;) {
				const version = own.version
				const sending = own.wanted
				const after = own.options.after
				if (after && !(await after)) {
					if (own.version !== version) continue
					put_back(own.confirmed)
					break
				}
				if (own.version !== version) continue
				try {
					if (sending === null) await fm.remove_xattr(id, name)
					else await fm.set_xattr(id, name, sending)
					own.confirmed = sending
				} catch (error) {
					if (own.version !== version) continue
					let cloud = own.confirmed
					try {
						cloud = await own.options.reread()
					} catch {
						// offline: the last value this client saw saved
					}
					own.confirmed = cloud
					put_back(cloud)
					own.options.on_error(error)
					break
				}
				if (own.version === version) break
			}
		} finally {
			all.delete(key)
			done()
			// refreshes that raced the write may hold a stale snapshot
			bump_folder_cache_generation(owner_id)
			const settled = own.wanted ?? PENDING_XATTR_REMOVED
			const scope = own.options.scope
			setTimeout(() => clear_pending_entry_xattr(id, name, settled, scope), 2000)
		}
	})()
	return own.running
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

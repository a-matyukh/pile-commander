import {
	createIdbBrowserStorage,
	type BrowserStorage,
} from '@pile-commander/file-manager'

/**
 * Web counterpart of desktopFolders.ts: web "local" desktops persist their
 * children to IndexedDB under the virtual root `/browser-desktops/<id>`
 * (id is the path — same contract as the Tauri fs backend).
 *
 * Unlike the Tauri helpers there is no trash: removal deletes permanently.
 */

const ROOTS_PARENT = '/browser-desktops'

let storage: BrowserStorage | null = null

/** False in environments without IndexedDB (some private modes). */
export function browser_storage_available(): boolean {
	return typeof indexedDB !== 'undefined'
}

/** Shared storage singleton; null when IndexedDB is unavailable. */
export function browser_storage(): BrowserStorage | null {
	if (!browser_storage_available()) return null
	storage ??= createIdbBrowserStorage()
	return storage
}

export function require_browser_storage(): BrowserStorage {
	const current = browser_storage()
	if (!current) {
		throw new Error('Browser storage (IndexedDB) is unavailable in this browser')
	}
	return current
}

export function browser_desktop_root(desktop_id: string): string {
	return `${ROOTS_PARENT}/${desktop_id}`
}

/**
 * Creates the desktop root if absent and returns its path. Insert-only:
 * re-putting the root record would wipe the board xattrs (camera, view
 * settings) that accumulate on it.
 */
export async function ensure_browser_desktop_root(desktop_id: string): Promise<string> {
	const current = require_browser_storage()
	const root = browser_desktop_root(desktop_id)
	const existing = await current.children_paths(ROOTS_PARENT)
	if (!existing.includes(root)) {
		await current.apply({
			entries: [
				{ path: ROOTS_PARENT, type: 'folder', xattrs: {} },
				{ path: root, type: 'folder', xattrs: {} },
			],
		})
	}
	return root
}

export async function browser_desktop_has_children(desktop_id: string): Promise<boolean> {
	const current = browser_storage()
	if (!current) return false
	try {
		return (await current.children_paths(browser_desktop_root(desktop_id))).length > 0
	} catch {
		return false
	}
}

/** True when this virtual path still has an entry in IndexedDB. */
export async function browser_entry_exists(path: string): Promise<boolean> {
	const current = browser_storage()
	if (!current) return false
	try {
		return await current.has(path)
	} catch {
		return false
	}
}

/** Permanent delete — browser storage has no trash. */
export async function remove_browser_desktop(desktop_id: string): Promise<void> {
	const current = browser_storage()
	if (!current) return
	await current.apply({ clear_prefix: browser_desktop_root(desktop_id) })
}

/** Deletes roots whose desktop no longer exists in localStorage. */
export async function prune_orphaned_browser_desktops(valid_ids: string[]): Promise<void> {
	const current = browser_storage()
	if (!current) return
	const valid = new Set(valid_ids)
	const roots = await current.children_paths(ROOTS_PARENT)
	await Promise.all(
		roots
			.map(root => root.slice(ROOTS_PARENT.length + 1))
			.filter(id => !valid.has(id))
			.map(id => current.apply({ clear_prefix: browser_desktop_root(id) })),
	)
}

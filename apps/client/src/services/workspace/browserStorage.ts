import {
	createIdbBrowserStorage,
	type BrowserStorage,
} from '@pile-commander/file-manager'

/**
 * IndexedDB storage for browser workspaces. One shared singleton so every
 * caller sees the same entries.
 */

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

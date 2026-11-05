import type { FolderWithChildrenXattrs } from '@pile-commander/file-manager'

/**
 * Cloud folder lists kept on this device, so a folder opened before shows at
 * once — after a restart too — while the cloud is read again behind it.
 * Bounded by count (the least recently shown go first). Unavailable storage
 * (a private window, an old webview) means no lists kept, never an error.
 */
export type FolderListDisk = {
	get(key: string): Promise<FolderWithChildrenXattrs | null>
	put(key: string, list: FolderWithChildrenXattrs): Promise<void>
	clear(): Promise<void>
}

/** How many folders the device keeps before the least recently shown go */
export const DISK_FOLDERS = 500

/** How long opening the device's store may take before the session goes without it */
const OPEN_WAIT_MS = 1000

const DB_NAME = 'pile-commander-folders'
const STORE = 'folders'

type Row = { key: string; list: FolderWithChildrenXattrs; at: number }

function request<T>(req: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		req.onsuccess = () => resolve(req.result)
		req.onerror = () => reject(req.error)
	})
}

function done(tx: IDBTransaction): Promise<void> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve()
		tx.onerror = () => reject(tx.error)
		tx.onabort = () => reject(tx.error)
	})
}

/** IndexedDB, in the web app and in the desktop app's webview */
export function indexeddb_folder_list_disk(limit = DISK_FOLDERS): FolderListDisk {
	let opened: Promise<IDBDatabase | null> | null = null
	const db = () => {
		opened ??= new Promise<IDBDatabase | null>((resolve) => {
			// WebKit (mobile Safari) can leave an open request without any event:
			// past the wait the device keeps no lists this session, never a hang
			const gave_up = setTimeout(() => resolve(null), OPEN_WAIT_MS)
			const settle = (database: IDBDatabase | null) => {
				clearTimeout(gave_up)
				resolve(database)
			}
			try {
				if (typeof indexedDB === 'undefined') return settle(null)
				const req = indexedDB.open(DB_NAME, 1)
				req.onupgradeneeded = () => {
					const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
					store.createIndex('at', 'at')
				}
				req.onsuccess = () => settle(req.result)
				req.onerror = () => settle(null)
				req.onblocked = () => settle(null)
			} catch {
				settle(null)
			}
		})
		return opened
	}

	async function evict(database: IDBDatabase) {
		const tx = database.transaction(STORE, 'readwrite')
		const finished = done(tx)
		let count = 0
		// newest first: past the limit are the least recently shown
		const cursor = tx.objectStore(STORE).index('at').openCursor(null, 'prev')
		cursor.onsuccess = () => {
			const at = cursor.result
			if (!at) return
			count += 1
			if (count > limit) at.delete()
			at.continue()
		}
		await finished
	}

	return {
		async get(key) {
			try {
				const database = await db()
				if (!database) return null
				const row = await request(database.transaction(STORE, 'readonly').objectStore(STORE).get(key)) as Row | undefined
				if (!row) return null
				// shown now: the last to go. Its own transaction (WebKit closes idle ones)
				try {
					database.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...row, at: Date.now() })
				} catch {
					// the order of eviction is a nicety
				}
				return row.list
			} catch {
				return null
			}
		},
		async put(key, list) {
			try {
				const database = await db()
				if (!database) return
				const tx = database.transaction(STORE, 'readwrite')
				tx.objectStore(STORE).put({ key, list, at: Date.now() } satisfies Row)
				await done(tx)
				await evict(database)
			} catch {
				// a full or unavailable disk: the list is still in memory
			}
		},
		async clear() {
			try {
				const database = await db()
				if (!database) return
				const tx = database.transaction(STORE, 'readwrite')
				tx.objectStore(STORE).clear()
				await done(tx)
			} catch {
				// nothing kept, or nothing to clear
			}
		},
	}
}

/** For tests: a disk in memory (it copies, as IndexedDB does) */
export function memory_folder_list_disk(): FolderListDisk & { keys(): string[] } {
	const rows = new Map<string, FolderWithChildrenXattrs>()
	return {
		async get(key) {
			const list = rows.get(key)
			return list ? structuredClone(list) : null
		},
		async put(key, list) { rows.set(key, structuredClone(list)) },
		async clear() { rows.clear() },
		keys: () => [...rows.keys()],
	}
}

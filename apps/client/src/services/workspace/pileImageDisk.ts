/**
 * Folder covers and backgrounds kept on this device, so a folder shows them
 * at once after a restart too. A `pile:` token names fixed bytes, so a kept
 * picture never goes stale: the key carries the workspace, the folder and the
 * token, and a renamed folder is only a miss. Bounded (least recently shown
 * go first). Unavailable storage (a private window, an old webview) means no
 * disk cache, never an error.
 */
export type PictureDisk = {
	get(key: string): Promise<Uint8Array | null>
	put(key: string, bytes: Uint8Array): Promise<void>
	clear(): Promise<void>
}

/** What the disk may hold before the least recently shown pictures go */
export const DISK_BYTES = 200 * 1024 * 1024

const DB_NAME = 'pile-commander-pictures'
const STORE = 'pictures'

type Row = { key: string; bytes: ArrayBuffer; size: number; at: number }

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
export function indexeddb_picture_disk(limit = DISK_BYTES): PictureDisk {
	let opened: Promise<IDBDatabase | null> | null = null
	const db = () => {
		opened ??= new Promise<IDBDatabase | null>((resolve) => {
			try {
				if (typeof indexedDB === 'undefined') return resolve(null)
				const req = indexedDB.open(DB_NAME, 1)
				req.onupgradeneeded = () => {
					const store = req.result.createObjectStore(STORE, { keyPath: 'key' })
					store.createIndex('at', 'at')
				}
				req.onsuccess = () => resolve(req.result)
				req.onerror = () => resolve(null)
				req.onblocked = () => resolve(null)
			} catch {
				resolve(null)
			}
		})
		return opened
	}

	async function evict(database: IDBDatabase) {
		const tx = database.transaction(STORE, 'readwrite')
		const store = tx.objectStore(STORE)
		let total = 0
		const rows: { key: string; size: number }[] = []
		await new Promise<void>((resolve, reject) => {
			// newest first: what is past the limit at the end is the least recently shown
			const cursor = store.index('at').openCursor(null, 'prev')
			cursor.onerror = () => reject(cursor.error)
			cursor.onsuccess = () => {
				const at = cursor.result
				if (!at) return resolve()
				const row = at.value as Row
				total += row.size
				if (total > limit) rows.push({ key: row.key, size: row.size })
				at.continue()
			}
		})
		for (const row of rows) store.delete(row.key)
		await done(tx)
	}

	return {
		async get(key) {
			try {
				const database = await db()
				if (!database) return null
				const tx = database.transaction(STORE, 'readwrite')
				const store = tx.objectStore(STORE)
				const row = await request(store.get(key)) as Row | undefined
				if (!row) return null
				// shown now: the last to go
				store.put({ ...row, at: Date.now() })
				await done(tx)
				return new Uint8Array(row.bytes)
			} catch {
				return null
			}
		},
		async put(key, bytes) {
			try {
				const database = await db()
				if (!database) return
				const copy = bytes.slice().buffer
				const tx = database.transaction(STORE, 'readwrite')
				tx.objectStore(STORE).put({ key, bytes: copy, size: bytes.byteLength, at: Date.now() } satisfies Row)
				await done(tx)
				await evict(database)
			} catch {
				// a full or unavailable disk: the picture is still in memory
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

/** For tests: a disk in memory */
export function memory_picture_disk(): PictureDisk & { keys(): string[] } {
	const rows = new Map<string, Uint8Array>()
	return {
		async get(key) { return rows.get(key)?.slice() ?? null },
		async put(key, bytes) { rows.set(key, bytes.slice()) },
		async clear() { rows.clear() },
		keys: () => [...rows.keys()],
	}
}

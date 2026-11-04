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

/** How long opening the device's store may take before the session goes without it */
const OPEN_WAIT_MS = 1000

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
			// WebKit (mobile Safari) can leave an open request without any event:
			// past the wait the device has no disk this session, never a hang
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
		const store = tx.objectStore(STORE)
		const finished = done(tx)
		let total = 0
		// newest first: what is past the limit is the least recently shown, and
		// goes inside the cursor's own callback, while the transaction is live
		const cursor = store.index('at').openCursor(null, 'prev')
		cursor.onsuccess = () => {
			const at = cursor.result
			if (!at) return
			const row = at.value as Row
			total += row.size
			if (total > limit) at.delete()
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
				// shown now: the last to go. Its own transaction: one left waiting
				// after an await may already be closed (WebKit)
				try {
					const touch = database.transaction(STORE, 'readwrite')
					touch.objectStore(STORE).put({ ...row, at: Date.now() })
				} catch {
					// the order of eviction is a nicety
				}
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

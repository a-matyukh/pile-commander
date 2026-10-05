import { openDB, type IDBPDatabase } from "idb"
import {
	browser_path_within,
	type BrowserEntryRecord,
	type BrowserConnectionsDoc,
	type BrowserStorage,
	type BrowserStorageSnapshot,
	type BrowserStrokesDoc,
	type BrowserSubtreeWrite,
} from "./storage"

const DB_NAME = "pile-commander-browser"
const DB_VERSION = 1
const STORE_NAMES = ["entries", "blobs", "strokes", "connections"] as const

type BlobRow = { path: string; blob: Blob }

let db: Promise<IDBPDatabase> | null = null

function open(): Promise<IDBPDatabase> {
	db ??= openDB(DB_NAME, DB_VERSION, {
		upgrade(database) {
			database.createObjectStore("entries", { keyPath: "path" })
			database.createObjectStore("blobs", { keyPath: "path" })
			database.createObjectStore("strokes", { keyPath: "folder" })
			database.createObjectStore("connections", { keyPath: "folder" })
		},
	})
	return db
}

/**
 * "Self + descendants" can't be a plain key range (a range for `ab` would
 * also match the sibling `ab2`), so filter keys by the exact predicate.
 * Desktop-scale key counts make getAllKeys fine.
 */
async function delete_prefix_from(
	store: {
		getAllKeys(): Promise<IDBValidKey[]>
		delete(key: IDBValidKey): Promise<unknown>
	},
	prefix: string,
): Promise<void> {
	const keys = await store.getAllKeys()
	for (const key of keys) {
		if (browser_path_within(String(key), prefix)) await store.delete(key)
	}
}

/** IndexedDB BrowserStorage — one transaction per `apply` call. */
export function createIdbBrowserStorage(): BrowserStorage {
	return {
		async load_all(): Promise<BrowserStorageSnapshot> {
			const database = await open()
			const tx = database.transaction(STORE_NAMES, "readonly")
			const [entries, blob_rows, strokes, connections] = await Promise.all([
				tx.objectStore("entries").getAll() as Promise<BrowserEntryRecord[]>,
				tx.objectStore("blobs").getAll() as Promise<BlobRow[]>,
				tx.objectStore("strokes").getAll() as Promise<BrowserStrokesDoc[]>,
				tx.objectStore("connections").getAll() as Promise<BrowserConnectionsDoc[]>,
			])
			await tx.done
			return { entries, blobs: blob_rows, strokes, connections }
		},

		async apply(write: BrowserSubtreeWrite): Promise<void> {
			const database = await open()
			const tx = database.transaction(STORE_NAMES, "readwrite")
			const entries = tx.objectStore("entries")
			const blobs = tx.objectStore("blobs")
			const strokes = tx.objectStore("strokes")
			const connections = tx.objectStore("connections")
			if (write.clear_prefix) {
				for (const store of [entries, blobs, strokes, connections]) {
					await delete_prefix_from(store, write.clear_prefix)
				}
			}
			for (const record of write.entries ?? []) void entries.put(record)
			for (const { path, blob } of write.blobs ?? []) void blobs.put({ path, blob })
			for (const path of write.blob_deletes ?? []) void blobs.delete(path)
			for (const doc of write.strokes ?? []) void strokes.put(doc)
			for (const doc of write.connections ?? []) void connections.put(doc)
			await tx.done
		},

		async children_paths(folder: string): Promise<string[]> {
			const database = await open()
			const keys = await database.getAllKeys("entries")
			const prefix = `${folder}/`
			const children: string[] = []
			for (const key of keys) {
				const path = String(key)
				if (!path.startsWith(prefix)) continue
				if (!path.slice(prefix.length).includes("/")) children.push(path)
			}
			return children
		},

		async has(path: string): Promise<boolean> {
			const database = await open()
			return (await database.get("entries", path)) !== undefined
		},
	}
}

import type { FolderConnection, FolderStroke } from "../types"

/**
 * One entry row: folder or file metadata + inline text content. Binary
 * payloads live in the blob store under the same path (`has_blob: true`).
 * `xattrs` is a plain map — structuredClone-able like every record here.
 */
export type BrowserEntryRecord = {
	path: string
	type: "file" | "folder"
	/** Inline text content; undefined for folders and blob-backed files. */
	content?: string
	/** True when the file bytes live in the blob store under the same path. */
	has_blob?: boolean
	xattrs: Record<string, string>
}

/** Per-folder canvas ink doc, keyed by folder path. */
export type BrowserStrokesDoc = {
	folder: string
	strokes: FolderStroke[]
}

/** Per-folder canvas edges doc, keyed by folder path. */
export type BrowserConnectionsDoc = {
	folder: string
	connections: FolderConnection[]
}

export type BrowserStorageSnapshot = {
	entries: BrowserEntryRecord[]
	blobs: { path: string; blob: Blob }[]
	strokes: BrowserStrokesDoc[]
	connections: BrowserConnectionsDoc[]
}

/**
 * Single atomic unit of persistence for one FileManager mutation. One
 * mutation = one `apply` call = one IndexedDB transaction, so subtree
 * operations (rename/move/copy/remove) never persist partially.
 */
export type BrowserSubtreeWrite = {
	/** Wipe entries, blobs and folder docs at this path and below before inserting. */
	clear_prefix?: string
	entries?: BrowserEntryRecord[]
	blobs?: { path: string; blob: Blob }[]
	/** Blob rows to delete (e.g. save_text_file over a blob-backed file). */
	blob_deletes?: string[]
	strokes?: BrowserStrokesDoc[]
	connections?: BrowserConnectionsDoc[]
}

export const browser_path_within = (path: string, prefix: string): boolean =>
	path === prefix || path.startsWith(`${prefix}/`)

/**
 * Persistence layer behind the browser FileManager backend. Implementations:
 * IndexedDB (`idbStorage.ts`) for the app, in-memory for unit tests.
 */
export interface BrowserStorage {
	/** Everything, for a one-shot hydration on startup. */
	load_all(): Promise<BrowserStorageSnapshot>
	/** Atomic mutation — see BrowserSubtreeWrite. */
	apply(write: BrowserSubtreeWrite): Promise<void>
	/** Immediate children paths of a folder (roots listing, has_children checks). */
	children_paths(folder: string): Promise<string[]>
	/** Whether an entry row exists at this path. */
	has(path: string): Promise<boolean>
}

/** In-memory BrowserStorage for unit tests — no fake-indexeddb needed. */
export function createMemoryBrowserStorage(): BrowserStorage {
	const entries = new Map<string, BrowserEntryRecord>()
	const blobs = new Map<string, Blob>()
	const strokes = new Map<string, FolderStroke[]>()
	const connections = new Map<string, FolderConnection[]>()

	function clear_prefix(prefix: string): void {
		for (const map of [entries, blobs, strokes, connections] as Map<string, unknown>[]) {
			for (const key of map.keys()) {
				if (browser_path_within(key, prefix)) map.delete(key)
			}
		}
	}

	return {
		async load_all() {
			return {
				entries: [...entries.values()],
				blobs: [...blobs.entries()].map(([path, blob]) => ({ path, blob })),
				strokes: [...strokes.entries()].map(([folder, list]) => ({ folder, strokes: list })),
				connections: [...connections.entries()].map(([folder, list]) => ({ folder, connections: list })),
			}
		},
		async apply(write) {
			if (write.clear_prefix) clear_prefix(write.clear_prefix)
			for (const record of write.entries ?? []) entries.set(record.path, record)
			for (const { path, blob } of write.blobs ?? []) blobs.set(path, blob)
			for (const path of write.blob_deletes ?? []) blobs.delete(path)
			for (const doc of write.strokes ?? []) strokes.set(doc.folder, doc.strokes)
			for (const doc of write.connections ?? []) connections.set(doc.folder, doc.connections)
		},
		async children_paths(folder) {
			const prefix = `${folder}/`
			const children: string[] = []
			for (const key of entries.keys()) {
				if (!key.startsWith(prefix)) continue
				if (!key.slice(prefix.length).includes("/")) children.push(key)
			}
			return children
		},
		async has(path) {
			return entries.has(path)
		},
	}
}

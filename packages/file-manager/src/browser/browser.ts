import { createFakeFileManager, type FakeEntrySnapshot } from "../fake"
import { download_blob } from "./download"
import type { FileManager, MediaSrc } from "../types"
import type {
	BrowserEntryRecord,
	BrowserStorage,
	BrowserSubtreeWrite,
} from "./storage"

function to_record(snapshot: FakeEntrySnapshot): BrowserEntryRecord {
	return {
		path: snapshot.path,
		type: snapshot.type,
		...(snapshot.type === "file" && !snapshot.has_blob ? { content: snapshot.content } : {}),
		...(snapshot.has_blob ? { has_blob: true } : {}),
		xattrs: snapshot.xattrs,
	}
}

/**
 * Browser FileManager: the test-covered in-memory fake as the live core,
 * with every mutation mirrored to durable browser storage (IndexedDB in the
 * app, in-memory in tests) in one transaction per mutation.
 *
 * Paths are virtual (`/browser-desktops/<desktop-id>/…`); id === path, same
 * contract as the local backend. Watchers are single-tab like the fake.
 *
 * If persistence rejects (e.g. QuotaExceededError), the call rejects and the
 * caller surfaces the error — the in-memory change stays until reload, where
 * hydration restores the last durable state.
 */
export function createBrowserFileManager(storage: BrowserStorage): FileManager {
	const core = createFakeFileManager()

	const ready = hydrate()

	async function hydrate(): Promise<void> {
		const snapshot = await storage.load_all()
		const blob_by_path = new Map(snapshot.blobs.map(row => [row.path, row.blob]))
		// parents before children: seed_entry overwrites, so a parent written
		// after its children would wipe nothing — but keep a stable,
		// depth-first order for readability of any failure
		const sorted = [...snapshot.entries].sort((a, b) => a.path.length - b.path.length)
		for (const record of sorted) {
			core.seed_entry(
				{
					path: record.path,
					type: record.type,
					content: record.content ?? "",
					has_blob: record.has_blob ?? false,
					xattrs: record.xattrs,
				},
				blob_by_path.get(record.path),
			)
		}
		for (const doc of snapshot.strokes) {
			if (core.has(doc.folder)) core.seed_strokes(doc.folder, doc.strokes)
		}
		for (const doc of snapshot.connections) {
			if (core.has(doc.folder)) core.seed_connections(doc.folder, doc.connections)
		}
	}

	function record_of(path: string): BrowserEntryRecord {
		const snapshot = core.list_entries(path).find(entry => entry.path === path)
		if (!snapshot) throw new Error(`browser FileManager: no entry at ${path}`)
		return to_record(snapshot)
	}

	/** Everything durable about the subtree rooted at `path`. */
	async function subtree_write(path: string): Promise<BrowserSubtreeWrite> {
		const write: Required<Omit<BrowserSubtreeWrite, "clear_prefix" | "blob_deletes">> = {
			entries: [],
			blobs: [],
			strokes: [],
			connections: [],
		}
		for (const snapshot of core.list_entries(path)) {
			write.entries.push(to_record(snapshot))
			if (snapshot.has_blob) {
				const blob = core.get_blob(snapshot.path)
				if (blob) write.blobs.push({ path: snapshot.path, blob })
			}
			if (snapshot.type !== "folder") continue
			const strokes = await core.fm.strokes.list_strokes(snapshot.path)
			if (strokes.length > 0) write.strokes.push({ folder: snapshot.path, strokes })
			const connections = await core.fm.connections.list_connections(snapshot.path)
			if (connections.length > 0) write.connections.push({ folder: snapshot.path, connections })
		}
		return write
	}

	async function persist_folder_docs(folder_id: string): Promise<void> {
		const strokes = await core.fm.strokes.list_strokes(folder_id)
		const connections = await core.fm.connections.list_connections(folder_id)
		await storage.apply({
			strokes: [{ folder: folder_id, strokes }],
			connections: [{ folder: folder_id, connections }],
		})
	}

	return {
		async FolderChildren(folder_id) {
			await ready
			return core.fm.FolderChildren(folder_id)
		},

		async open_file(id) {
			await ready
			// no OS opener in the browser — download the bytes instead
			const blob = core.get_blob(id) ?? new Blob([await core.fm.read_text_file(id)], { type: "text/plain" })
			download_blob(blob, id.slice(id.lastIndexOf("/") + 1))
		},

		async create_folder(folder_id, folder_name, options) {
			await ready
			const child = await core.fm.create_folder(folder_id, folder_name, options)
			await storage.apply({ entries: [record_of(child.id)] })
			return child
		},

		async create_text_file(folder_id, filename, options) {
			await ready
			const child = await core.fm.create_text_file(folder_id, filename, options)
			await storage.apply({ entries: [record_of(child.id)] })
			return child
		},

		async read_text_file(id) {
			await ready
			return core.fm.read_text_file(id)
		},

		async get_media_src(id, options): Promise<MediaSrc> {
			await ready
			const blob = core.get_blob(id)
			if (blob) {
				// re-type when the caller knows better (uploads store raw bytes)
				const typed = options?.mimeType && blob.type !== options.mimeType
					? new Blob([blob], { type: options.mimeType })
					: blob
				const url = URL.createObjectURL(typed)
				return { url, revoke: () => URL.revokeObjectURL(url) }
			}
			return core.fm.get_media_src(id, options)
		},

		async save_text_file(id, content) {
			await ready
			await core.fm.save_text_file(id, content)
			// a blob-backed file becomes text: drop its blob row
			await storage.apply({ entries: [record_of(id)], blob_deletes: [id] })
		},

		async upload_file(folder_id, filename, data, mime, onProgress) {
			await ready
			const child = await core.fm.upload_file(folder_id, filename, data, mime, onProgress)
			await storage.apply({
				entries: [record_of(child.id)],
				blobs: [{ path: child.id, blob: data }],
			})
			return child
		},

		async rename(id, new_name) {
			await ready
			const patch = await core.fm.rename(id, new_name)
			await storage.apply({ clear_prefix: id, ...(await subtree_write(patch.id)) })
			return patch
		},

		async move(id, target_folder_id, new_name) {
			await ready
			const patch = await core.fm.move(id, target_folder_id, new_name)
			await storage.apply({ clear_prefix: id, ...(await subtree_write(patch.id)) })
			return patch
		},

		async copy_file(source_path, target_folder_id, new_name) {
			await ready
			const child = await core.fm.copy_file(source_path, target_folder_id, new_name)
			await storage.apply(await subtree_write(child.id))
			return child
		},

		async copy_entry(source_path, target_folder_id, new_name) {
			await ready
			const child = await core.fm.copy_entry(source_path, target_folder_id, new_name)
			await storage.apply(await subtree_write(child.id))
			return child
		},

		async remove(id) {
			await ready
			await core.fm.remove(id)
			await storage.apply({ clear_prefix: id })
		},

		async set_xattr(id, name, value) {
			await ready
			await core.fm.set_xattr(id, name, value)
			await storage.apply({ entries: [record_of(id)] })
		},

		async set_xattrs(items) {
			await ready
			const result = await core.fm.set_xattrs(items)
			const missing = new Set(result.missing)
			const applied = items.filter(item => !missing.has(item.id))
			// one transaction for the whole batch
			if (applied.length > 0) {
				await storage.apply({ entries: applied.map(item => record_of(item.id)) })
			}
			return result
		},

		async entry_size(id) {
			await ready
			return core.fm.entry_size(id)
		},

		async get_xattr(id, name) {
			await ready
			return core.fm.get_xattr(id, name)
		},

		async remove_xattr(id, name) {
			await ready
			await core.fm.remove_xattr(id, name)
			await storage.apply({ entries: [record_of(id)] })
		},

		async list_xattrs(id) {
			await ready
			return core.fm.list_xattrs(id)
		},

		async folder_with_children_xattrs(id) {
			await ready
			return core.fm.folder_with_children_xattrs(id)
		},

		strokes: {
			async list_strokes(folder_id) {
				await ready
				return core.fm.strokes.list_strokes(folder_id)
			},
			async upsert_strokes(folder_id, strokes) {
				await ready
				await core.fm.strokes.upsert_strokes(folder_id, strokes)
				await persist_folder_docs(folder_id)
			},
			async delete_strokes(folder_id, stroke_ids) {
				await ready
				await core.fm.strokes.delete_strokes(folder_id, stroke_ids)
				await persist_folder_docs(folder_id)
			},
			async watch_strokes(folder_id, on_event) {
				await ready
				return core.fm.strokes.watch_strokes(folder_id, on_event)
			},
		},

		connections: {
			async list_connections(folder_id) {
				await ready
				return core.fm.connections.list_connections(folder_id)
			},
			async upsert_connections(folder_id, connections) {
				await ready
				await core.fm.connections.upsert_connections(folder_id, connections)
				await persist_folder_docs(folder_id)
			},
			async delete_connections(folder_id, connection_ids) {
				await ready
				await core.fm.connections.delete_connections(folder_id, connection_ids)
				await persist_folder_docs(folder_id)
			},
			async watch_connections(folder_id, on_event) {
				await ready
				return core.fm.connections.watch_connections(folder_id, on_event)
			},
		},

		async watch(folder_id, on_event, options) {
			await ready
			return core.fm.watch(folder_id, on_event, options)
		},
	}
}

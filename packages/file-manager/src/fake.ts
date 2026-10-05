import type {
	ConnectionsWatchEvent,
	EntryWithXattrs,
	FileManager,
	FolderChild,
	FolderConnection,
	FolderStroke,
	StrokesWatchEvent,
	Unwatch,
	WatchEvent,
	Xattr,
} from "./types"
import { resolve_folder_connections } from "./connectionPaths"

type Entry = {
	type: "file" | "folder"
	content: string
	/** set by upload_file; a later save_text_file replaces it with plain text */
	blob?: Blob
	/**
	 * URL-backed file (the demo pack): bytes stay on the server until read,
	 * media renders straight from the URL. A save replaces it like a blob.
	 */
	src?: string
	/** byte size of a URL-backed file, known without fetching it */
	size?: number
	xattrs: Map<string, string>
}

/**
 * Durable view of one entry: everything the browser backend persists.
 * `content` is inline text; blob-backed files carry `has_blob` and their
 * bytes travel separately (seed via `seed_entry(…, blob)`, read via
 * `get_blob`).
 */
export type FakeEntrySnapshot = {
	path: string
	type: "file" | "folder"
	content: string
	has_blob: boolean
	xattrs: Record<string, string>
}

export type FakeFileManager = {
	fm: FileManager
	seed_folder(path: string): void
	seed_file(path: string, content?: string): void
	/** Hydration counterpart of `list_entries` — one call per entry. */
	seed_entry(entry: FakeEntrySnapshot, blob?: Blob): void
	/** A file whose bytes live at `src` and load only when read. */
	seed_url_file(path: string, src: string, size: number): void
	set_xattr(path: string, name: string, value: string): void
	get_xattr(path: string, name: string): string | null
	has(path: string): boolean
	/**
	 * Durable snapshots of every entry at `prefix` and below (the prefix
	 * itself included); without `prefix`, the whole tree. Read-only:
	 * mutating the returned objects does not touch the core.
	 */
	list_entries(prefix?: string): FakeEntrySnapshot[]
	/** Raw binary payload of a blob-backed file; null otherwise. */
	get_blob(path: string): Blob | null
	/** Makes the next call to `method` reject. */
	fail_once(method: keyof FileManager): void
	/** Deliver a watch event to subscribers of `folder_id`. */
	emit_watch_event(folder_id: string, event: WatchEvent): void
	/** Replace a folder's strokes without emitting (test setup). */
	seed_strokes(folder_id: string, strokes: FolderStroke[]): void
	/** Deliver a strokes event to subscribers, as another client would. */
	emit_strokes_event(folder_id: string, event: StrokesWatchEvent): void
	/** Replace a folder's connections without emitting (test setup). */
	seed_connections(folder_id: string, connections: FolderConnection[]): void
	/** Deliver a connections event to subscribers, as another client would. */
	emit_connections_event(folder_id: string, event: ConnectionsWatchEvent): void
	calls: { method: string; args: unknown[] }[]
}

/**
 * In-memory FileManager implementation over Map<path, entry>.
 * Paths use '/' as separator; id === path, mirroring the local implementation.
 */
export function createFakeFileManager(): FakeFileManager {
	const entries = new Map<string, Entry>()
	const failures = new Set<string>()
	const calls: { method: string; args: unknown[] }[] = []
	const watchers = new Map<string, Set<(event: WatchEvent) => void>>()
	const strokes_by_folder = new Map<string, Map<string, FolderStroke>>()
	const strokes_watchers = new Map<string, Set<(event: StrokesWatchEvent) => void>>()
	const connections_by_folder = new Map<string, Map<string, FolderConnection>>()
	const connections_watchers = new Map<string, Set<(event: ConnectionsWatchEvent) => void>>()

	function folder_strokes(folder_id: string): Map<string, FolderStroke> {
		let map = strokes_by_folder.get(folder_id)
		if (!map) {
			map = new Map()
			strokes_by_folder.set(folder_id, map)
		}
		return map
	}

	function emit_strokes(folder_id: string, event: StrokesWatchEvent) {
		for (const listener of strokes_watchers.get(folder_id) ?? []) listener(event)
	}

	function folder_connections(folder_id: string): Map<string, FolderConnection> {
		let map = connections_by_folder.get(folder_id)
		if (!map) {
			map = new Map()
			connections_by_folder.set(folder_id, map)
		}
		return map
	}

	function emit_connections(folder_id: string, event: ConnectionsWatchEvent) {
		for (const listener of connections_watchers.get(folder_id) ?? []) listener(event)
	}

	// Mirrors rebase_connection in local.ts (kept separate: local.ts pulls in
	// Tauri modules, the fake must stay runtime-agnostic)
	function rebase_endpoint(endpoint: string, old_root: string, new_root: string): string {
		if (endpoint === old_root) return new_root
		if (endpoint.startsWith(old_root + "/")) return new_root + endpoint.slice(old_root.length)
		return endpoint
	}

	function rebase_connection(connection: FolderConnection, old_root: string, new_root: string): FolderConnection {
		const from = rebase_endpoint(connection.from, old_root, new_root)
		const to = rebase_endpoint(connection.to, old_root, new_root)
		if (from === connection.from && to === connection.to) return connection
		const deterministic_id = `${connection.from}:${connection.from_handle ?? "default"}-${connection.to}:${connection.to_handle ?? "default"}`
		const id = connection.id === deterministic_id
			? `${from}:${connection.from_handle ?? "default"}-${to}:${connection.to_handle ?? "default"}`
			: connection.id
		return { ...connection, id, from, to }
	}

	const basename = (p: string) => p.slice(p.lastIndexOf("/") + 1)
	// cloud-style root: parent of "/x" is "/", not ""
	const parent = (p: string) => {
		const idx = p.lastIndexOf("/")
		return idx <= 0 ? "/" : p.slice(0, idx)
	}
	// cloud-style paths: joining at the root must not produce "//name"
	const join = (folder: string, name: string) =>
		folder === "/" || folder === "" ? `/${name}` : `${folder}/${name}`

	function track(method: string, args: unknown[]) {
		calls.push({ method, args })
		if (failures.delete(method)) {
			throw new Error(`fake FileManager: injected ${method} failure`)
		}
	}

	async function fetch_src(src: string): Promise<Blob> {
		const response = await fetch(src)
		if (!response.ok) throw new Error(`fake FileManager: ${src} answered ${response.status}`)
		return response.blob()
	}

	function must(path: string): Entry {
		const entry = entries.get(path)
		if (!entry) throw new Error(`fake FileManager: no entry at ${path}`)
		return entry
	}

	function entry_xattrs(path: string): Xattr[] {
		return [...must(path).xattrs].map(([name, value]) => ({ name, value }))
	}

	function children_paths(folder: string): string[] {
		return [...entries.keys()].filter(p => p !== folder && parent(p) === folder)
	}

	function child_entry(path: string): EntryWithXattrs {
		return {
			id: path,
			name: basename(path),
			type: must(path).type,
			xattrs: entry_xattrs(path),
		}
	}

	function move_subtree(old_path: string, new_path: string) {
		const moves: [string, string][] = []
		for (const p of entries.keys()) {
			if (p === old_path || p.startsWith(old_path + "/")) {
				moves.push([p, new_path + p.slice(old_path.length)])
			}
		}
		for (const [from, to] of moves) {
			entries.set(to, entries.get(from)!)
			entries.delete(from)
		}
		// folder ink travels with the folder, like the on-disk `.pile` sidecar
		for (const p of [...strokes_by_folder.keys()]) {
			if (p === old_path || p.startsWith(old_path + "/")) {
				strokes_by_folder.set(new_path + p.slice(old_path.length), strokes_by_folder.get(p)!)
				strokes_by_folder.delete(p)
			}
		}
		// connections too; endpoint paths inside are rebased onto the new
		// subtree — same as local rename/move walking `.pile/connections.json`
		for (const p of [...connections_by_folder.keys()]) {
			if (p === old_path || p.startsWith(old_path + "/")) {
				const rebased = [...connections_by_folder.get(p)!.values()]
					.map((connection) => rebase_connection(connection, old_path, new_path))
				connections_by_folder.set(
					new_path + p.slice(old_path.length),
					new Map(rebased.map((connection) => [connection.id, connection])),
				)
				connections_by_folder.delete(p)
			}
		}
	}

	const fm: FileManager = {
		async FolderChildren(folder_id): Promise<FolderChild[]> {
			track("FolderChildren", [folder_id])
			return children_paths(folder_id).map(p => ({
				id: p,
				type: must(p).type,
				name: basename(p),
			}))
		},
		async open_file(id) {
			track("open_file", [id])
			must(id)
		},
		async create_folder(folder_id, folder_name, options) {
			track("create_folder", [folder_id, folder_name])
			must(folder_id)
			const path = join(folder_id, folder_name)
			entries.set(path, { type: "folder", content: "", xattrs: new Map(Object.entries(options?.xattrs ?? {})) })
			return { id: path, type: "folder", name: folder_name }
		},
		async create_text_file(folder_id, filename, options) {
			track("create_text_file", [folder_id, filename])
			must(folder_id)
			const path = join(folder_id, filename)
			entries.set(path, {
				type: "file",
				content: options?.content ?? "",
				xattrs: new Map(Object.entries(options?.xattrs ?? {})),
			})
			return { id: path, type: "file", name: filename }
		},
		async read_text_file(id) {
			track("read_text_file", [id])
			const entry = must(id)
			if (entry.blob) return entry.blob.text()
			if (entry.src) return fetch_src(entry.src).then(blob => blob.text())
			return entry.content
		},
		async get_media_src(id) {
			track("get_media_src", [id])
			const entry = must(id)
			// the URL is already servable: no object URL to make or revoke
			if (entry.src && !entry.blob) return { url: entry.src, revoke: () => {} }
			// mirrors the cloud/local implementations: text content is served
			// as a Blob object URL too, so callers can always fetch the url
			const blob = entry.blob ?? new Blob([entry.content], { type: "text/plain" })
			const url = URL.createObjectURL(blob)
			return { url, revoke: () => URL.revokeObjectURL(url) }
		},
		async save_text_file(id, content) {
			track("save_text_file", [id, content])
			const entry = must(id)
			entry.content = content
			delete entry.blob
			delete entry.src
			delete entry.size
		},
		async upload_file(folder_id, filename, data, mime, onProgress) {
			track("upload_file", [folder_id, filename, data.size, mime ?? null])
			must(folder_id)
			const path = join(folder_id, filename)
			entries.set(path, { type: "file", content: "", blob: data, xattrs: new Map() })
			onProgress?.(data.size, data.size)
			return { id: path, type: "file", name: filename }
		},
		async rename(id, new_name) {
			track("rename", [id, new_name])
			must(id)
			const new_path = join(parent(id), new_name)
			move_subtree(id, new_path)
			return { id: new_path, name: new_name }
		},
		async move(id, target_folder_id, new_name) {
			track("move", [id, target_folder_id, new_name])
			must(id)
			must(target_folder_id)
			const name = new_name ?? basename(id)
			const new_path = join(target_folder_id, name)
			move_subtree(id, new_path)
			return { id: new_path, name }
		},
		async copy_file(source_path, target_folder_id, new_name) {
			track("copy_file", [source_path, target_folder_id, new_name])
			const source = must(source_path)
			if (source.type !== "file") {
				throw new Error(`fake FileManager: ${source_path} is not a file`)
			}
			must(target_folder_id)
			const name = new_name ?? basename(source_path)
			const path = join(target_folder_id, name)
			entries.set(path, {
				type: "file",
				content: source.content,
				blob: source.blob,
				src: source.src,
				size: source.size,
				xattrs: new Map(source.xattrs),
			})
			return { id: path, type: "file", name }
		},
		async copy_entry(source_path, target_folder_id, new_name) {
			track("copy_entry", [source_path, target_folder_id, new_name])
			const source = must(source_path)
			must(target_folder_id)
			const name = new_name ?? basename(source_path)
			const dest = join(target_folder_id, name)

			function copy_subtree(from: string, to: string) {
				const entry = must(from)
				entries.set(to, {
					type: entry.type,
					content: entry.content,
					blob: entry.blob,
					src: entry.src,
					size: entry.size,
					xattrs: new Map(entry.xattrs),
				})
				if (entry.type !== "folder") return
				for (const child of children_paths(from)) {
					copy_subtree(child, join(to, basename(child)))
				}
			}

			copy_subtree(source_path, dest)
			for (const p of [...strokes_by_folder.keys()]) {
				if (p === source_path || p.startsWith(source_path + "/")) {
					strokes_by_folder.set(
						dest + p.slice(source_path.length),
						new Map(strokes_by_folder.get(p)!),
					)
				}
			}
			// edges copy with the folder, rebased onto the new subtree —
			// mirrors the local copy_entry sidecar rewrite
			for (const p of [...connections_by_folder.keys()]) {
				if (p === source_path || p.startsWith(source_path + "/")) {
					const rebased = [...connections_by_folder.get(p)!.values()]
						.map((connection) => rebase_connection(connection, source_path, dest))
					connections_by_folder.set(
						dest + p.slice(source_path.length),
						new Map(rebased.map((connection) => [connection.id, connection])),
					)
				}
			}
			return { id: dest, type: source.type, name }
		},
		async remove(id) {
			track("remove", [id])
			must(id)
			for (const p of [...entries.keys()]) {
				if (p === id || p.startsWith(id + "/")) {
					entries.delete(p)
				}
			}
			for (const p of [...strokes_by_folder.keys()]) {
				if (p === id || p.startsWith(id + "/")) {
					strokes_by_folder.delete(p)
				}
			}
			for (const p of [...connections_by_folder.keys()]) {
				if (p === id || p.startsWith(id + "/")) {
					connections_by_folder.delete(p)
				}
			}
		},
		async set_xattr(id, name, value) {
			track("set_xattr", [id, name, value])
			must(id).xattrs.set(name, value)
		},
		async set_xattrs(items) {
			track("set_xattrs", [items])
			const missing: string[] = []
			for (const item of items) {
				const entry = entries.get(item.id)
				if (!entry) {
					missing.push(item.id)
					continue
				}
				for (const [name, value] of Object.entries(item.xattrs)) entry.xattrs.set(name, value)
			}
			return { missing }
		},
		async entry_size(id) {
			track("entry_size", [id])
			const entry = must(id)
			if (entry.type === "folder") return 0
			if (entry.blob) return entry.blob.size
			if (entry.src) return entry.size ?? 0
			return new TextEncoder().encode(entry.content).byteLength
		},
		async get_xattr(id, name) {
			track("get_xattr", [id, name])
			return must(id).xattrs.get(name) ?? null
		},
		async remove_xattr(id, name) {
			track("remove_xattr", [id, name])
			must(id).xattrs.delete(name)
		},
		async list_xattrs(id) {
			track("list_xattrs", [id])
			return entry_xattrs(id)
		},
		async folder_with_children_xattrs(id) {
			track("folder_with_children_xattrs", [id])
			const entry = must(id)
			if (entry.type !== "folder") {
				throw new Error(`fake FileManager: ${id} is not a folder`)
			}
			return {
				id,
				name: basename(id),
				type: "folder" as const,
				xattrs: entry_xattrs(id),
				children: children_paths(id).map(child_entry),
			}
		},
		async watch(folder_id, on_event, options): Promise<Unwatch> {
			track("watch", [folder_id, options])
			let listeners = watchers.get(folder_id)
			if (!listeners) {
				listeners = new Set()
				watchers.set(folder_id, listeners)
			}
			listeners.add(on_event)
			return () => {
				listeners!.delete(on_event)
				if (listeners!.size === 0) watchers.delete(folder_id)
			}
		},
		strokes: {
			async list_strokes(folder_id) {
				track("list_strokes", [folder_id])
				must(folder_id)
				return [...folder_strokes(folder_id).values()].sort((a, b) => a.z - b.z)
			},
			async upsert_strokes(folder_id, strokes) {
				track("upsert_strokes", [folder_id, strokes])
				must(folder_id)
				const map = folder_strokes(folder_id)
				for (const stroke of strokes) map.set(stroke.id, stroke)
				emit_strokes(folder_id, { upserted: strokes, deleted: [] })
			},
			async delete_strokes(folder_id, stroke_ids) {
				track("delete_strokes", [folder_id, stroke_ids])
				must(folder_id)
				const map = folder_strokes(folder_id)
				const deleted = stroke_ids.filter(id => map.delete(id))
				if (deleted.length > 0) emit_strokes(folder_id, { upserted: [], deleted })
			},
			async watch_strokes(folder_id, on_event): Promise<Unwatch> {
				track("watch_strokes", [folder_id])
				let listeners = strokes_watchers.get(folder_id)
				if (!listeners) {
					listeners = new Set()
					strokes_watchers.set(folder_id, listeners)
				}
				listeners.add(on_event)
				return () => {
					listeners!.delete(on_event)
					if (listeners!.size === 0) strokes_watchers.delete(folder_id)
				}
			},
		},
		connections: {
			async list_connections(folder_id) {
				track("list_connections", [folder_id])
				must(folder_id)
				const raw = [...folder_connections(folder_id).values()]
				const healed = resolve_folder_connections(raw, folder_id)
				if (healed !== raw) {
					connections_by_folder.set(
						folder_id,
						new Map(healed.map((connection) => [connection.id, connection])),
					)
				}
				return healed
			},
			async upsert_connections(folder_id, connections) {
				track("upsert_connections", [folder_id, connections])
				must(folder_id)
				const map = folder_connections(folder_id)
				for (const connection of connections) map.set(connection.id, connection)
				emit_connections(folder_id, { upserted: connections, deleted: [] })
			},
			async delete_connections(folder_id, connection_ids) {
				track("delete_connections", [folder_id, connection_ids])
				must(folder_id)
				const map = folder_connections(folder_id)
				const deleted = connection_ids.filter(id => map.delete(id))
				if (deleted.length > 0) emit_connections(folder_id, { upserted: [], deleted })
			},
			async watch_connections(folder_id, on_event): Promise<Unwatch> {
				track("watch_connections", [folder_id])
				let listeners = connections_watchers.get(folder_id)
				if (!listeners) {
					listeners = new Set()
					connections_watchers.set(folder_id, listeners)
				}
				listeners.add(on_event)
				return () => {
					listeners!.delete(on_event)
					if (listeners!.size === 0) connections_watchers.delete(folder_id)
				}
			},
		},
	}

	return {
		fm,
		seed_folder(path) {
			entries.set(path, { type: "folder", content: "", xattrs: new Map() })
		},
		seed_file(path, content = "") {
			entries.set(path, { type: "file", content, xattrs: new Map() })
		},
		seed_url_file(path, src, size) {
			entries.set(path, { type: "file", content: "", src, size, xattrs: new Map() })
		},
		seed_entry(entry, blob) {
			entries.set(entry.path, {
				type: entry.type,
				content: entry.content,
				...(blob ? { blob } : {}),
				xattrs: new Map(Object.entries(entry.xattrs)),
			})
		},
		set_xattr(path, name, value) {
			must(path).xattrs.set(name, value)
		},
		get_xattr(path, name) {
			return must(path).xattrs.get(name) ?? null
		},
		has(path) {
			return entries.has(path)
		},
		list_entries(prefix) {
			const result: FakeEntrySnapshot[] = []
			for (const [path, entry] of entries) {
				if (prefix && path !== prefix && !path.startsWith(prefix + "/")) continue
				result.push({
					path,
					type: entry.type,
					content: entry.blob ? "" : entry.content,
					has_blob: entry.blob !== undefined,
					xattrs: Object.fromEntries(entry.xattrs),
				})
			}
			return result
		},
		get_blob(path) {
			return entries.get(path)?.blob ?? null
		},
		fail_once(method) {
			failures.add(method)
		},
		emit_watch_event(folder_id, event) {
			const listeners = watchers.get(folder_id)
			if (!listeners) return
			for (const listener of listeners) listener(event)
		},
		seed_strokes(folder_id, strokes) {
			strokes_by_folder.set(folder_id, new Map(strokes.map(s => [s.id, s])))
		},
		emit_strokes_event(folder_id, event) {
			emit_strokes(folder_id, event)
		},
		seed_connections(folder_id, connections) {
			connections_by_folder.set(folder_id, new Map(connections.map(c => [c.id, c])))
		},
		emit_connections_event(folder_id, event) {
			emit_connections(folder_id, event)
		},
		calls,
	}
}

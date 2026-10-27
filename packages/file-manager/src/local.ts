import {
	copyFile,
	mkdir,
	readDir,
	readFile,
	readTextFile,
	remove,
	rename as fs_rename,
	stat,
	watch as fs_watch,
	watchImmediate as fs_watch_immediate,
	writeFile,
	writeTextFile,
	type DirEntry,
	type WatchEvent as TauriWatchEvent,
	type WatchEventKind as TauriWatchEventKind,
} from "@tauri-apps/plugin-fs"
import { openPath } from "@tauri-apps/plugin-opener"
import { invoke } from "@tauri-apps/api/core"
import { basename, dirname, join } from "@tauri-apps/api/path"
import * as xattrs from "@pile-commander/tauri-plugin-xattrs"
import { PILE_DIR_NAME } from "./pile-attrs"
import { reprefix_path, resolve_folder_connections } from "./connectionPaths"
import type { CreateFolderOptions, CreateTextFileOptions, FileManager, FolderChild, FolderConnection, FolderStroke, Unwatch, UploadProgressCallback, WatchEvent, WatchEventKind } from "./types"

/** Sidecar dir files holding per-folder canvas entities — never shown in listings. */
const STROKES_FILE = "strokes.json"
const CONNECTIONS_FILE = "connections.json"

/**
 * POSIX rename silently replaces an existing target, and the default macOS
 * and Windows file systems ignore case and Unicode composition, so
 * `Beach.jpg` would replace `beach.jpg`, and an NFC `й` an NFD one. A name
 * that folds onto another entry is refused. `keep` is the entry's own name
 * when it already sits in `parent` (a rename, or a move back into that
 * same folder): compared in NFC, a case-only change is not a clash with
 * itself. A move into another folder passes no `keep`, because a file
 * there with the same name is a different file.
 */
async function refuse_taken_name(parent: string, new_name: string, keep?: string) {
	const fold = (name: string) => name.normalize("NFC").toLowerCase()
	const wanted = fold(new_name)
	const own = keep?.normalize("NFC")
	const entries = await readDir(parent)
	if (entries.some(entry => entry.name.normalize("NFC") !== own && fold(entry.name) === wanted)) {
		throw new Error(`"${new_name}" already exists in this folder`)
	}
}

function is_pile_path(path: string): boolean {
	return path.split(/[/\\]/).includes(PILE_DIR_NAME)
}

/** Maps Tauri's nested watch event union into our flat `WatchEvent`. */
export function map_tauri_watch_event(event: TauriWatchEvent): WatchEvent {
	const kind = map_tauri_watch_kind(event.type)
	const type = event.type
	// an xattr write (layout) is a metadata change: the bytes are the same
	const metadata_only = typeof type === "object" && "modify" in type && type.modify.kind === "metadata"
	return metadata_only
		? { kind, ids: event.paths, content_changed: false }
		: { kind, ids: event.paths }
}

function map_tauri_watch_kind(type: TauriWatchEventKind): WatchEventKind {
	if (type === "any" || type === "other") return "other"
	if ("create" in type) return "create"
	if ("remove" in type) return "remove"
	if ("modify" in type) {
		return type.modify.kind === "rename" ? "rename" : "modify"
	}
	return "other"
}

async function entry_to_child(parent_path: string, entry: DirEntry): Promise<FolderChild> {
	const path = await join(parent_path, entry.name)
	return {
		id: path,
		type: entry.isDirectory ? "folder" : "file",
		name: entry.name,
	}
}

async function set_initial_xattrs(path: string, attrs: Record<string, string> | undefined) {
	for (const [name, value] of Object.entries(attrs ?? {})) {
		await xattrs.set_xattr(path, name, value)
	}
}

async function copy_xattrs(source_path: string, dest_path: string) {
	const attrs = await xattrs.list_xattrs(source_path)
	for (const { name, value } of attrs) {
		await xattrs.set_xattr(dest_path, name, value)
	}
}

async function copy_folder_recursive(
	source_path: string,
	target_folder_id: string,
	name: string,
): Promise<FolderChild> {
	const dest_path = await join(target_folder_id, name)
	await mkdir(dest_path)
	await copy_xattrs(source_path, dest_path)

	const entries = await readDir(source_path)
	for (const entry of entries) {
		if (!entry.name) continue
		const child_source = await join(source_path, entry.name)
		if (entry.isDirectory) {
			await copy_folder_recursive(child_source, dest_path, entry.name)
		} else {
			const child_dest = await join(dest_path, entry.name)
			await copyFile(child_source, child_dest)
			await copy_xattrs(child_source, child_dest)
		}
	}

	return { id: dest_path, type: "folder", name }
}

export type LocalFileManagerOptions = {
	/**
	 * Delete via the OS trash (Tauri `trash_path` command) instead of the
	 * permanent plugin-fs remove — used by desktop boards, where deletion is
	 * the user's own files on their desktop
	 */
	remove_to_trash?: boolean
}

function createLocalFileManager(options?: LocalFileManagerOptions): FileManager {
	return {
		async FolderChildren(folder_path: string): Promise<FolderChild[]> {
			const entries = await readDir(folder_path)
			return Promise.all(
				entries
					.filter((entry) => entry.name !== PILE_DIR_NAME)
					.map((entry) => entry_to_child(folder_path, entry)),
			)
		},
		async open_file(path: string) {
			await openPath(path)
		},
		async remove(path: string) {
			if (options?.remove_to_trash) {
				await invoke("trash_path", { path })
				return
			}
			await remove(path, { recursive: true })
		},
		async create_folder(folder_path: string, folder_name: string, options?: CreateFolderOptions) {
			const path = await join(folder_path, folder_name)
			await mkdir(path)
			await set_initial_xattrs(path, options?.xattrs)
			return { id: path, type: "folder", name: folder_name }
		},
		async create_text_file(folder_path: string, filename: string, options?: CreateTextFileOptions) {
			const path = await join(folder_path, filename)
			await writeTextFile(path, options?.content ?? "")
			await set_initial_xattrs(path, options?.xattrs)
			return { id: path, type: "file", name: filename }
		},
		async read_text_file(path: string) {
			return readTextFile(path)
		},
		async get_media_src(path: string, options?: { mimeType?: string }) {
			const bytes = await readFile(path)
			const blob = new Blob([bytes], {
				type: options?.mimeType ?? "application/octet-stream",
			})
			const url = URL.createObjectURL(blob)
			return {
				url,
				revoke: () => URL.revokeObjectURL(url),
			}
		},
		async save_text_file(path: string, content: string) {
			await writeTextFile(path, content)
		},
		async upload_file(folder_id: string, filename: string, data: Blob, _mime?: string, onProgress?: UploadProgressCallback) {
			const path = await join(folder_id, filename)
			await writeFile(path, new Uint8Array(await data.arrayBuffer()))
			onProgress?.(data.size, data.size)
			return { id: path, type: "file" as const, name: filename }
		},
		async rename(path: string, new_name: string) {
			const parent = await dirname(path)
			const new_path = await join(parent, new_name)
			await refuse_taken_name(parent, new_name, await basename(path))
			await fs_rename(path, new_path)
			try {
				await rebase_connections_sidecars(new_path, path, new_path)
			} catch {
				// file, or unreadable dir — sidecar walk is best-effort
			}
			return { id: new_path, name: await basename(new_path) }
		},
		async move(path: string, target_folder_id: string, new_name?: string) {
			const current = await basename(path)
			const name = new_name ?? current
			const new_path = await join(target_folder_id, name)
			const source_folder = await dirname(path)
			await refuse_taken_name(
				target_folder_id,
				name,
				source_folder === target_folder_id ? current : undefined,
			)
			await fs_rename(path, new_path)
			try {
				await rebase_connections_sidecars(new_path, path, new_path)
			} catch {
				// file, or unreadable dir — sidecar walk is best-effort
			}
			return { id: new_path, name }
		},
		async copy_file(source_path: string, target_folder_id: string, new_name?: string) {
			const name = new_name ?? await basename(source_path)
			const new_path = await join(target_folder_id, name)
			await copyFile(source_path, new_path)
			return { id: new_path, type: "file" as const, name }
		},
	async copy_entry(source_path: string, target_folder_id: string, new_name?: string) {
		const name = new_name ?? await basename(source_path)
		const info = await stat(source_path)
		if (info.isDirectory) {
			const child = await copy_folder_recursive(source_path, target_folder_id, name)
			// The .pile sidecars arrive verbatim; endpoint paths inside
			// connections.json still point at the source subtree — rebase
			// them onto the copy (mirrors the copy_entry RPC's id remap)
			await rebase_connections_sidecars(child.id, source_path, child.id)
			return child
		}
		const new_path = await join(target_folder_id, name)
		await copyFile(source_path, new_path)
		await copy_xattrs(source_path, new_path)
		return { id: new_path, type: "file" as const, name }
	},
		async set_xattr(id, name, value) {
			await xattrs.set_xattr(id, name, value)
		},
		async set_xattrs(items) {
			const missing: string[] = []
			for (const item of items) {
				try {
					for (const [name, value] of Object.entries(item.xattrs)) {
						await xattrs.set_xattr(item.id, name, value)
					}
				} catch {
					missing.push(item.id)
				}
			}
			return { missing }
		},
		async entry_size(path) {
			const info = await stat(path)
			return info.isDirectory ? 0 : info.size
		},
		async get_xattr(id, name) {
			return xattrs.get_xattr(id, name)
		},
		async remove_xattr(id, name) {
			await xattrs.remove_xattr(id, name)
		},
		async list_xattrs(id) {
			return xattrs.list_xattrs(id)
		},
		async folder_with_children_xattrs(id) {
			const { folder, children } = await xattrs.folder_with_children_xattrs(id)
			return {
				id: folder.path,
				name: folder.name,
				type: "folder" as const,
				xattrs: folder.xattrs,
				children: children.map(({ path, name, type, xattrs }) => ({
					id: path,
					name,
					type,
					xattrs,
				})),
			}
		},
		async watch(folder_id, on_event, options) {
			return fs_watch(
				folder_id,
				(event) => {
					const mapped = map_tauri_watch_event(event)
					const ids = mapped.ids.filter((path) => !is_pile_path(path))
					if (ids.length === 0) return
					on_event({ ...mapped, ids })
				},
				{
					recursive: options?.recursive,
					delayMs: options?.delay_ms,
				},
			)
		},
		strokes: createLocalStrokesStore(),
		connections: createLocalConnectionsStore(),
	}
}

/**
 * The watched path does not exist. notify reports it as "No path was found."
 * (macOS FSEvents checks the path first); an io error says ENOENT
 */
function is_missing_dir_error(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error)
	return /no path was found|no such file or directory|os error 2\b/i.test(message)
}

async function sidecar_file_path(folder_path: string, file_name: string): Promise<string> {
	return join(folder_path, PILE_DIR_NAME, file_name)
}

/** Missing or corrupt sidecar reads as "no records" — never fails the board. */
async function read_sidecar_file<T extends { id: string }>(folder_path: string, file_name: string): Promise<T[]> {
	try {
		const raw = await readTextFile(await sidecar_file_path(folder_path, file_name))
		const parsed: unknown = JSON.parse(raw)
		if (!Array.isArray(parsed)) return []
		return parsed.filter(
			(record): record is T =>
				typeof record === "object" && record != null && typeof (record as { id?: unknown }).id === "string",
		)
	} catch {
		return []
	}
}

async function write_sidecar_file<T>(folder_path: string, file_name: string, records: T[]): Promise<void> {
	const pile_dir = await join(folder_path, PILE_DIR_NAME)
	await mkdir(pile_dir, { recursive: true })
	const target = await join(pile_dir, file_name)
	const tmp = await join(pile_dir, `${file_name}.tmp`)
	await writeTextFile(tmp, JSON.stringify(records))
	await fs_rename(tmp, target)
}

/** Read-modify-write store over a `.pile/<file>` JSON array, shared by strokes and connections. */
function createLocalSidecarStore<T extends { id: string }>(file_name: string) {
	return {
		async list(folder_id: string): Promise<T[]> {
			return read_sidecar_file(folder_id, file_name)
		},
		async upsert(folder_id: string, records: T[]): Promise<void> {
			const current = await read_sidecar_file<T>(folder_id, file_name)
			const by_id = new Map(current.map((record) => [record.id, record]))
			for (const record of records) by_id.set(record.id, record)
			await write_sidecar_file(folder_id, file_name, [...by_id.values()])
		},
		async remove(folder_id: string, ids: string[]): Promise<void> {
			const doomed = new Set(ids)
			const remaining = (await read_sidecar_file<T>(folder_id, file_name)).filter((record) => !doomed.has(record.id))
			await write_sidecar_file(folder_id, file_name, remaining)
		},
		/**
		 * Two one-level watches, never a recursive one: a recursive watch of the
		 * folder walks its whole subtree up front (the debouncer's file-id
		 * cache), on the main thread, which froze the app on ~/Library. The
		 * folder watch notices `.pile` appearing or being replaced; the `.pile`
		 * watch sees the sidecar file itself
		 */
		async watch(folder_id: string, on_event: (event: { upserted: T[]; deleted: string[] }) => void): Promise<Unwatch> {
			const pile_dir = await join(folder_id, PILE_DIR_NAME)
			const target_path = await join(pile_dir, file_name)
			let known = new Map(
				(await read_sidecar_file<T>(folder_id, file_name)).map((record) => [record.id, JSON.stringify(record)]),
			)
			let closed = false
			let pile_unwatch: Unwatch | null = null

			const on_change = async () => {
				const next = await read_sidecar_file<T>(folder_id, file_name)
				if (closed) return
				const upserted = next.filter((record) => known.get(record.id) !== JSON.stringify(record))
				const deleted = [...known.keys()].filter((id) => !next.some((record) => record.id === id))
				known = new Map(next.map((record) => [record.id, JSON.stringify(record)]))
				if (upserted.length === 0 && deleted.length === 0) return
				on_event({ upserted, deleted })
			}

			// Each (re)arm bumps the generation: an older subscription that
			// resolves later is dropped, so only one `.pile` watch is ever live
			let pile_generation = 0
			// The old `.pile` watch stays until its replacement is live, so a
			// failed re-arm (EMFILE, …) keeps watching instead of going quiet
			const arm_pile = async () => {
				const generation = ++pile_generation
				let next: Unwatch
				try {
					next = await fs_watch_immediate(
						pile_dir,
						(event) => {
							if (event.paths.some((path) => path === target_path)) void on_change()
						},
						{ recursive: false },
					)
				} catch (error) {
					if (generation !== pile_generation) return
					// No `.pile` (yet, or any more): the folder watch arms this once
					// it appears. Any other failure is real and goes to the caller
					if (!is_missing_dir_error(error)) throw error
					pile_unwatch?.()
					pile_unwatch = null
					return
				}
				if (closed || generation !== pile_generation) {
					next()
					return
				}
				pile_unwatch?.()
				pile_unwatch = next
			}

			const folder_unwatch = await fs_watch_immediate(
				folder_id,
				(event) => {
					if (!event.paths.some((path) => path === pile_dir)) return
					void arm_pile()
						.then(on_change)
						.catch((error) => console.error("[pile] could not watch", pile_dir, error))
				},
				{ recursive: false },
			)
			try {
				await arm_pile()
			} catch (error) {
				folder_unwatch()
				throw error
			}
			return () => {
				closed = true
				folder_unwatch()
				pile_unwatch?.()
			}
		},
	}
}

function createLocalStrokesStore(): FileManager["strokes"] {
	const sidecar = createLocalSidecarStore<FolderStroke>(STROKES_FILE)
	return {
		list_strokes: sidecar.list,
		upsert_strokes: sidecar.upsert,
		delete_strokes: sidecar.remove,
		watch_strokes: sidecar.watch,
	}
}

function createLocalConnectionsStore(): FileManager["connections"] {
	const sidecar = createLocalSidecarStore<FolderConnection>(CONNECTIONS_FILE)
	return {
		async list_connections(folder_id) {
			const list = await sidecar.list(folder_id)
			const healed = resolve_folder_connections(list, folder_id)
			if (healed !== list) {
				await write_sidecar_file(folder_id, CONNECTIONS_FILE, healed)
			}
			return healed
		},
		upsert_connections: sidecar.upsert,
		delete_connections: sidecar.remove,
		async watch_connections(folder_id, on_event) {
			return sidecar.watch(folder_id, (event) => {
				on_event({
					upserted: resolve_folder_connections(event.upserted, folder_id),
					deleted: event.deleted,
				})
			})
		},
	}
}

function rebase_connection_endpoint(endpoint: string, old_root: string, new_root: string): string {
	return reprefix_path(endpoint, old_root, new_root) ?? endpoint
}

function rebase_connection(connection: FolderConnection, old_root: string, new_root: string): FolderConnection {
	const from = rebase_connection_endpoint(connection.from, old_root, new_root)
	const to = rebase_connection_endpoint(connection.to, old_root, new_root)
	if (from === connection.from && to === connection.to) return connection

	// The deterministic id embeds the endpoints, so it is recomputed;
	// collision-fallback ids (uuids) stay — they are globally unique
	const deterministic_id = `${connection.from}:${connection.from_handle ?? "default"}-${connection.to}:${connection.to_handle ?? "default"}`
	const id = connection.id === deterministic_id
		? `${from}:${connection.from_handle ?? "default"}-${to}:${connection.to_handle ?? "default"}`
		: connection.id
	return { ...connection, id, from, to }
}

/** Rewrites endpoint paths in every copied `.pile/connections.json` under `dir`. */
async function rebase_connections_sidecars(dir: string, old_root: string, new_root: string): Promise<void> {
	let raw: string | null = null
	try {
		raw = await readTextFile(await sidecar_file_path(dir, CONNECTIONS_FILE))
	} catch {
		// no sidecar in this folder
	}
	if (raw !== null) {
		try {
			const parsed: unknown = JSON.parse(raw)
			if (Array.isArray(parsed)) {
				const rebased = parsed
					.filter(
						(record): record is FolderConnection =>
							typeof record === "object" && record != null && typeof (record as { id?: unknown }).id === "string",
					)
					.map((connection) => rebase_connection(connection, old_root, new_root))
				await write_sidecar_file(dir, CONNECTIONS_FILE, rebased)
			}
		} catch {
			// corrupt sidecar: keep the verbatim copy
		}
	}

	let entries: DirEntry[] = []
	try {
		entries = await readDir(dir)
	} catch {
		return
	}
	for (const entry of entries) {
		if (entry.isDirectory && entry.name !== PILE_DIR_NAME) {
			await rebase_connections_sidecars(await join(dir, entry.name), old_root, new_root)
		}
	}
}

export default createLocalFileManager

import type { FileManager, FolderChild } from "./types"

export type MockFileManagerOptions = {
	/**
	 * Probability of a random failure on mutating / listing calls (0–1).
	 * Disabled by default so mock mode is deterministic.
	 */
	failure_rate?: number
}

function sleep(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function maybe_fail<T>(ok: T, failure_rate: number, message: string): Promise<T> {
	if (failure_rate > 0 && Math.random() < failure_rate) {
		return Promise.reject(new Error(message))
	}
	return Promise.resolve(ok)
}

function createMockFileManager(options?: MockFileManagerOptions): FileManager {
	const failure_rate = options?.failure_rate ?? 0

	return {
		async FolderChildren(folder_id: string) {
			console.log("fm:folder_children", folder_id)
			await sleep(1000)
			return maybe_fail(
				[
					{
						id: "fd0eb23d-d9f5-465a-ad32-aacc7d74ba98",
						type: "file" as const,
						name: "my song.wav",
					},
				],
				failure_rate,
				"Some troubles",
			)
		},
		async open_file(id: string) {
			console.log("fm:open_file", id)
		},
		async remove(id: string) {
			console.log("fm:remove", id)
			await sleep(500)
			return maybe_fail(undefined, failure_rate, "Some troubles")
		},
		async create_folder(folder_id: string, folder_name: string): Promise<FolderChild> {
			console.log("fm:create_folder", folder_id, folder_name)
			await sleep(500)
			return maybe_fail({
				id: crypto.randomUUID(),
				type: "folder" as const,
				name: folder_name,
			}, failure_rate, "Some troubles")
		},
		async create_text_file(folder_id: string, filename: string): Promise<FolderChild> {
			console.log("fm:create_text_file", folder_id, filename)
			await sleep(500)
			return maybe_fail({
				id: crypto.randomUUID(),
				type: "file" as const,
				name: filename,
			}, failure_rate, "Some troubles")
		},
		async read_text_file(id: string) {
			console.log("fm:read_text_file", id)
			return ""
		},
		async get_media_src(id: string) {
			console.log("fm:get_media_src", id)
			return Promise.reject(new Error("Media preview is not available in mock mode"))
		},
		async save_text_file(id: string, content: string) {
			console.log("fm:save_text_file", id, content)
		},
		async upload_file(folder_id: string, filename: string, data: Blob): Promise<FolderChild> {
			console.log("fm:upload_file", folder_id, filename, data.size)
			await sleep(500)
			return maybe_fail({
				id: `${folder_id}/${filename}`,
				type: "file" as const,
				name: filename,
			}, failure_rate, "Some troubles")
		},
		async rename(id: string, new_name: string) {
			console.log("fm:rename", id, new_name)
			await sleep(500)
			return maybe_fail({ id, name: new_name }, failure_rate, "Some troubles")
		},
		async move(id: string, target_folder_id: string, new_name?: string) {
			console.log("fm:move", id, target_folder_id, new_name)
			await sleep(500)
			const name = new_name ?? id.split(/[/\\]/).pop() ?? id
			return maybe_fail({
				id: `${target_folder_id}/${name}`,
				name,
			}, failure_rate, "Some troubles")
		},
		async copy_file(source_path: string, target_folder_id: string, new_name?: string) {
			console.log("fm:copy_file", source_path, target_folder_id, new_name)
			await sleep(500)
			const name = new_name ?? source_path.split(/[/\\]/).pop() ?? source_path
			return maybe_fail({
				id: `${target_folder_id}/${name}`,
				type: "file" as const,
				name,
			}, failure_rate, "Some troubles")
		},
		async copy_entry(source_path: string, target_folder_id: string, new_name?: string) {
			console.log("fm:copy_entry", source_path, target_folder_id, new_name)
			await sleep(500)
			const name = new_name ?? source_path.split(/[/\\]/).pop() ?? source_path
			return maybe_fail({
				id: `${target_folder_id}/${name}`,
				type: "file" as const,
				name,
			}, failure_rate, "Some troubles")
		},
		async set_xattr(id, name, value) {
			console.log("fm:set_xattr", id, name, value)
		},
		async set_xattrs(items) {
			console.log("fm:set_xattrs", items.length)
			return { missing: [] }
		},
		async entry_size(id) {
			console.log("fm:entry_size", id)
			return 0
		},
		async get_xattr(id, name) {
			console.log("fm:get_xattr", id, name)
			return null
		},
		async remove_xattr(id, name) {
			console.log("fm:remove_xattr", id, name)
		},
		async list_xattrs(id) {
			console.log("fm:list_xattrs", id)
			return []
		},
		async folder_with_children_xattrs(id) {
			console.log("fm:folder_with_children_xattrs", id)
			return {
				id,
				name: id.split(/[/\\]/).pop() ?? id,
				type: "folder" as const,
				xattrs: [],
				children: [],
			}
		},
		async watch(folder_id, on_event, options) {
			console.log("fm:watch", folder_id, options)
			void on_event
			return () => {
				console.log("fm:unwatch", folder_id)
			}
		},
		strokes: {
			async list_strokes(folder_id) {
				console.log("fm:list_strokes", folder_id)
				return []
			},
			async upsert_strokes(folder_id, strokes) {
				console.log("fm:upsert_strokes", folder_id, strokes.length)
			},
			async delete_strokes(folder_id, stroke_ids) {
				console.log("fm:delete_strokes", folder_id, stroke_ids)
			},
			async watch_strokes(folder_id, on_event) {
				console.log("fm:watch_strokes", folder_id)
				void on_event
				return () => {
					console.log("fm:unwatch_strokes", folder_id)
				}
			},
		},
		connections: {
			async list_connections(folder_id) {
				console.log("fm:list_connections", folder_id)
				return []
			},
			async upsert_connections(folder_id, connections) {
				console.log("fm:upsert_connections", folder_id, connections.length)
			},
			async delete_connections(folder_id, connection_ids) {
				console.log("fm:delete_connections", folder_id, connection_ids)
			},
			async watch_connections(folder_id, on_event) {
				console.log("fm:watch_connections", folder_id)
				void on_event
				return () => {
					console.log("fm:unwatch_connections", folder_id)
				}
			},
		},
	}
}

export default createMockFileManager

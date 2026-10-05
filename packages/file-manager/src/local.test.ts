import { beforeEach, describe, expect, mock, test } from "bun:test"
import type { DirEntry, WatchEvent as TauriWatchEvent } from "@tauri-apps/plugin-fs"
import type { WatchEvent } from "./types"

const readDir = mock<(path: string) => Promise<DirEntry[]>>()
const mkdir = mock<(path: string) => Promise<void>>()
const remove = mock<(path: string, options?: { recursive?: boolean }) => Promise<void>>()
const fs_rename = mock<(oldPath: string, newPath: string) => Promise<void>>()
const copyFile = mock<(fromPath: string, toPath: string) => Promise<void>>()
const stat = mock<(path: string) => Promise<{ isDirectory: boolean; isFile: boolean }>>()
const writeTextFile = mock<(path: string, contents: string) => Promise<void>>()
const writeFile = mock<(path: string, data: Uint8Array) => Promise<void>>()
const readTextFile = mock<(path: string) => Promise<string>>()
const readFile = mock<(path: string) => Promise<Uint8Array>>()
const openPath = mock<(path: string) => Promise<void>>()
const fs_watch = mock<
	(
		paths: string | string[],
		cb: (event: TauriWatchEvent) => void,
		options?: { recursive?: boolean; delayMs?: number },
	) => Promise<() => void>
>()

const join = mock((...parts: string[]) =>
	Promise.resolve(parts.join("/").replace(/\/+/g, "/")),
)
const dirname = mock((path: string) => {
	const parts = path.split("/")
	parts.pop()
	return Promise.resolve(parts.join("/") || "/")
})
const basename = mock((path: string) =>
	Promise.resolve(path.split("/").pop() ?? path),
)

const set_xattr = mock<(path: string, name: string, value: string) => Promise<void>>()
const get_xattr = mock<(path: string, name: string) => Promise<string | null>>()
const remove_xattr = mock<(path: string, name: string) => Promise<void>>()
const list_xattrs = mock<(path: string) => Promise<{ name: string; value: string }[]>>()
const folder_with_children_xattrs = mock<
	(path: string) => Promise<{
		folder: { path: string; name: string; type: "folder"; xattrs: [] }
		children: []
	}>
>()

mock.module("@tauri-apps/plugin-fs", () => ({
	readDir,
	mkdir,
	remove,
	rename: fs_rename,
	copyFile,
	stat,
	writeTextFile,
	writeFile,
	readTextFile,
	readFile,
	watch: fs_watch,
}))

mock.module("@tauri-apps/plugin-opener", () => ({
	openPath,
}))

mock.module("@tauri-apps/api/path", () => ({
	join,
	dirname,
	basename,
}))

const invoke = mock<(cmd: string, args?: unknown) => Promise<unknown>>()

mock.module("@tauri-apps/api/core", () => ({
	invoke,
}))

mock.module("@pile-commander/tauri-plugin-xattrs", () => ({
	set_xattr,
	get_xattr,
	remove_xattr,
	list_xattrs,
	folder_with_children_xattrs,
}))

const { default: createLocalFileManager, map_tauri_watch_event } = await import("./local")

describe("createLocalFileManager", () => {
	beforeEach(() => {
		readDir.mockReset()
		mkdir.mockReset()
		remove.mockReset()
		fs_rename.mockReset()
		copyFile.mockReset()
		stat.mockReset()
		writeTextFile.mockReset()
		writeFile.mockReset()
		readTextFile.mockReset()
		readFile.mockReset()
		openPath.mockReset()
		fs_watch.mockReset()
		join.mockReset()
		dirname.mockReset()
		basename.mockReset()
		set_xattr.mockReset()
		get_xattr.mockReset()
		remove_xattr.mockReset()
		invoke.mockReset()
		list_xattrs.mockReset()
		folder_with_children_xattrs.mockReset()

		stat.mockResolvedValue({ isDirectory: false, isFile: true })
		list_xattrs.mockResolvedValue([])

		join.mockImplementation((...parts: string[]) =>
			Promise.resolve(parts.join("/").replace(/\/+/g, "/")),
		)
		dirname.mockImplementation((path: string) => {
			const parts = path.split("/")
			parts.pop()
			return Promise.resolve(parts.join("/") || "/")
		})
		basename.mockImplementation((path: string) =>
			Promise.resolve(path.split("/").pop() ?? path),
		)
		fs_watch.mockResolvedValue(() => {})
	})

	test("FolderChildren maps directory entries to folder children", async () => {
		readDir.mockResolvedValue([
			{ name: "notes.txt", isDirectory: false, isFile: true, isSymlink: false },
			{ name: "archive", isDirectory: true, isFile: false, isSymlink: false },
		])

		const fm = createLocalFileManager()
		const children = await fm.FolderChildren("/home/user")

		expect(readDir).toHaveBeenCalledWith("/home/user")
		expect(children).toEqual([
			{ id: "/home/user/notes.txt", type: "file", name: "notes.txt" },
			{ id: "/home/user/archive", type: "folder", name: "archive" },
		])
	})

	test("create_folder creates a directory and returns metadata", async () => {
		const fm = createLocalFileManager()
		const child = await fm.create_folder("/home/user", "projects")

		expect(mkdir).toHaveBeenCalledWith("/home/user/projects")
		expect(child).toEqual({
			id: "/home/user/projects",
			type: "folder",
			name: "projects",
		})
	})

	test("create_text_file writes an empty file and returns metadata", async () => {
		const fm = createLocalFileManager()
		const child = await fm.create_text_file("/home/user", "todo.md")

		expect(writeTextFile).toHaveBeenCalledWith("/home/user/todo.md", "")
		expect(child).toEqual({
			id: "/home/user/todo.md",
			type: "file",
			name: "todo.md",
		})
	})

	test("create_text_file writes initial content and xattrs", async () => {
		const fm = createLocalFileManager()
		await fm.create_text_file("/home/user", "shape.svg", {
			content: "<svg/>",
			xattrs: { is_preview: "true" },
		})

		expect(writeTextFile).toHaveBeenCalledWith("/home/user/shape.svg", "<svg/>")
		expect(set_xattr).toHaveBeenCalledWith("/home/user/shape.svg", "is_preview", "true")
	})

	test("read_text_file reads file contents", async () => {
		readTextFile.mockResolvedValue("hello")
		const fm = createLocalFileManager()

		await expect(fm.read_text_file("/home/user/note.txt")).resolves.toBe("hello")
		expect(readTextFile).toHaveBeenCalledWith("/home/user/note.txt")
	})

	test("get_media_src returns a blob URL with revoke", async () => {
		const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
		readFile.mockResolvedValue(pngBytes)
		const fm = createLocalFileManager()

		const media = await fm.get_media_src("/home/user/photo.png", {
			mimeType: "image/png",
		})

		expect(readFile).toHaveBeenCalledWith("/home/user/photo.png")
		expect(media.url.startsWith("blob:")).toBe(true)
		expect(typeof media.revoke).toBe("function")
		media.revoke?.()
	})

	test("save_text_file writes file contents", async () => {
		const fm = createLocalFileManager()
		await fm.save_text_file("/home/user/note.txt", "updated")

		expect(writeTextFile).toHaveBeenCalledWith("/home/user/note.txt", "updated")
	})

	test("upload_file writes bytes and returns metadata", async () => {
		const fm = createLocalFileManager()
		const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47])
		const child = await fm.upload_file("/home/user", "photo.png", new Blob([bytes]))

		expect(writeFile).toHaveBeenCalled()
		const [written_path, written_bytes] = writeFile.mock.calls[0]!
		expect(written_path).toBe("/home/user/photo.png")
		expect([...written_bytes!]).toEqual([...bytes])
		expect(child).toEqual({
			id: "/home/user/photo.png",
			type: "file",
			name: "photo.png",
		})
	})

	test("rename moves an item within the same parent directory", async () => {
		const fm = createLocalFileManager()
		const patch = await fm.rename("/home/user/old.txt", "new.txt")

		expect(dirname).toHaveBeenCalledWith("/home/user/old.txt")
		expect(fs_rename).toHaveBeenCalledWith("/home/user/old.txt", "/home/user/new.txt")
		expect(patch).toEqual({ id: "/home/user/new.txt", name: "new.txt" })
	})

	test("move relocates an item to another folder", async () => {
		const fm = createLocalFileManager()
		const patch = await fm.move("/home/user/report.pdf", "/home/archive")

		expect(basename).toHaveBeenCalledWith("/home/user/report.pdf")
		expect(fs_rename).toHaveBeenCalledWith(
			"/home/user/report.pdf",
			"/home/archive/report.pdf",
		)
		expect(patch).toEqual({
			id: "/home/archive/report.pdf",
			name: "report.pdf",
		})
	})

	test("move uses a custom name when provided", async () => {
		const fm = createLocalFileManager()
		const patch = await fm.move("/home/user/report.pdf", "/home/archive", "report (1).pdf")

		expect(basename).not.toHaveBeenCalled()
		expect(fs_rename).toHaveBeenCalledWith(
			"/home/user/report.pdf",
			"/home/archive/report (1).pdf",
		)
		expect(patch).toEqual({
			id: "/home/archive/report (1).pdf",
			name: "report (1).pdf",
		})
	})

	test("copy_file copies into the target folder", async () => {
		const fm = createLocalFileManager()
		const child = await fm.copy_file("/tmp/photo.png", "/home/user")

		expect(basename).toHaveBeenCalledWith("/tmp/photo.png")
		expect(copyFile).toHaveBeenCalledWith("/tmp/photo.png", "/home/user/photo.png")
		expect(child).toEqual({
			id: "/home/user/photo.png",
			type: "file",
			name: "photo.png",
		})
	})

	test("copy_file uses a custom name when provided", async () => {
		const fm = createLocalFileManager()
		const child = await fm.copy_file("/tmp/photo.png", "/home/user", "photo (1).png")

		expect(basename).not.toHaveBeenCalled()
		expect(copyFile).toHaveBeenCalledWith("/tmp/photo.png", "/home/user/photo (1).png")
		expect(child).toEqual({
			id: "/home/user/photo (1).png",
			type: "file",
			name: "photo (1).png",
		})
	})

	test("copy_entry copies a file and its xattrs", async () => {
		list_xattrs.mockResolvedValue([{ name: "cover", value: "#fff" }])
		const fm = createLocalFileManager()
		const child = await fm.copy_entry("/tmp/photo.png", "/home/user")

		expect(stat).toHaveBeenCalledWith("/tmp/photo.png")
		expect(copyFile).toHaveBeenCalledWith("/tmp/photo.png", "/home/user/photo.png")
		expect(set_xattr).toHaveBeenCalledWith("/home/user/photo.png", "cover", "#fff")
		expect(child).toEqual({
			id: "/home/user/photo.png",
			type: "file",
			name: "photo.png",
		})
	})

	test("copy_entry recursively copies a folder", async () => {
		stat.mockResolvedValue({ isDirectory: true, isFile: false })
		readDir
			.mockResolvedValueOnce([
				{ name: "nested", isDirectory: true, isFile: false, isSymlink: false },
				{ name: "a.txt", isDirectory: false, isFile: true, isSymlink: false },
			])
			.mockResolvedValueOnce([
				{ name: "b.txt", isDirectory: false, isFile: true, isSymlink: false },
			])
			// the connections-rebase pass walks the copy afterwards
			.mockResolvedValue([])
		list_xattrs.mockResolvedValue([])
		readTextFile.mockRejectedValue(new Error("no such file"))

		const fm = createLocalFileManager()
		const child = await fm.copy_entry("/tmp/album", "/home/user", "album (1)")

		expect(mkdir).toHaveBeenCalledWith("/home/user/album (1)")
		expect(mkdir).toHaveBeenCalledWith("/home/user/album (1)/nested")
		expect(copyFile).toHaveBeenCalledWith("/tmp/album/a.txt", "/home/user/album (1)/a.txt")
		expect(copyFile).toHaveBeenCalledWith(
			"/tmp/album/nested/b.txt",
			"/home/user/album (1)/nested/b.txt",
		)
		expect(child).toEqual({
			id: "/home/user/album (1)",
			type: "folder",
			name: "album (1)",
		})
	})

	test("remove deletes a path recursively", async () => {
		const fm = createLocalFileManager()
		await fm.remove("/home/user/trash")

		expect(remove).toHaveBeenCalledWith("/home/user/trash", { recursive: true })
	})

	test("remove_to_trash deletes via the OS trash command", async () => {
		const fm = createLocalFileManager({ remove_to_trash: true })
		await fm.remove("/home/user/trash")

		expect(invoke).toHaveBeenCalledWith("trash_path", { path: "/home/user/trash" })
		expect(remove).not.toHaveBeenCalled()
	})

	test("open_file delegates to the opener plugin", async () => {
		const fm = createLocalFileManager()
		await fm.open_file("/home/user/readme.md")

		expect(openPath).toHaveBeenCalledWith("/home/user/readme.md")
	})

	test("xattr methods delegate to tauri-plugin-xattrs", async () => {
		get_xattr.mockResolvedValue("alice")
		list_xattrs.mockResolvedValue([{ name: "author", value: "alice" }])
		folder_with_children_xattrs.mockResolvedValue({
			folder: {
				path: "/home/user",
				name: "user",
				type: "folder",
				xattrs: [],
			},
			children: [],
		})

		const fm = createLocalFileManager()

		await fm.set_xattr("/home/user/file.txt", "author", "alice")
		expect(set_xattr).toHaveBeenCalledWith("/home/user/file.txt", "author", "alice")

		await expect(fm.get_xattr("/home/user/file.txt", "author")).resolves.toBe("alice")
		expect(get_xattr).toHaveBeenCalledWith("/home/user/file.txt", "author")

		await fm.remove_xattr("/home/user/file.txt", "author")
		expect(remove_xattr).toHaveBeenCalledWith("/home/user/file.txt", "author")

		await expect(fm.list_xattrs("/home/user/file.txt")).resolves.toEqual([
			{ name: "author", value: "alice" },
		])
		expect(list_xattrs).toHaveBeenCalledWith("/home/user/file.txt")

		await expect(fm.folder_with_children_xattrs("/home/user")).resolves.toEqual({
			id: "/home/user",
			name: "user",
			type: "folder",
			xattrs: [],
			children: [],
		})
		expect(folder_with_children_xattrs).toHaveBeenCalledWith("/home/user")
	})

	test("watch wraps plugin-fs watch and maps options", async () => {
		const unwatch = mock(() => {})
		fs_watch.mockResolvedValue(unwatch)

		const fm = createLocalFileManager()
		const on_event = mock<(event: WatchEvent) => void>()
		const result = await fm.watch("/home/user", on_event, {
			recursive: true,
			delay_ms: 500,
		})

		expect(fs_watch).toHaveBeenCalledWith(
			"/home/user",
			expect.any(Function),
			{ recursive: true, delayMs: 500 },
		)
		expect(result).toBe(unwatch)

		const tauri_cb = fs_watch.mock.calls[0]![1]
		tauri_cb({
			type: { create: { kind: "file" } },
			paths: ["/home/user/new.txt"],
			attrs: {},
		})
		expect(on_event).toHaveBeenCalledWith({
			kind: "create",
			ids: ["/home/user/new.txt"],
		})
	})

	test("FolderChildren hides the .pile sidecar directory", async () => {
		readDir.mockResolvedValue([
			{ name: "notes.txt", isDirectory: false, isFile: true, isSymlink: false },
			{ name: ".pile", isDirectory: true, isFile: false, isSymlink: false },
		])

		const fm = createLocalFileManager()
		const children = await fm.FolderChildren("/home/user")

		expect(children).toEqual([
			{ id: "/home/user/notes.txt", type: "file", name: "notes.txt" },
		])
	})

	test("watch drops events under .pile and strips pile paths from mixed events", async () => {
		const fm = createLocalFileManager()
		const on_event = mock<(event: WatchEvent) => void>()
		await fm.watch("/home/user", on_event, { recursive: true })
		const tauri_cb = fs_watch.mock.calls[0]![1]

		tauri_cb({
			type: { modify: { kind: "data", mode: "content" } },
			paths: ["/home/user/.pile/strokes.json"],
			attrs: {},
		})
		expect(on_event).not.toHaveBeenCalled()

		tauri_cb({
			type: { create: { kind: "file" } },
			paths: ["/home/user/.pile/strokes.json", "/home/user/new.txt"],
			attrs: {},
		})
		expect(on_event).toHaveBeenCalledWith({
			kind: "create",
			ids: ["/home/user/new.txt"],
		})
	})
})

describe("local strokes store (.pile/strokes.json)", () => {
	// This describe sits outside "createLocalFileManager", so reset the mocks
	// it relies on itself — otherwise calls/implementations leak between tests.
	beforeEach(() => {
		readTextFile.mockReset()
		writeTextFile.mockReset()
		mkdir.mockReset()
		fs_rename.mockReset()
		fs_watch.mockReset()
		fs_watch.mockResolvedValue(() => {})
	})

	const stroke = {
		id: "s1",
		z: 1,
		position: { x: 10, y: 20 },
		points: [{ x: 0, y: 0 }, { x: 5.25, y: 7.5 }],
		color: "#f00",
		stroke_width: 3,
		width: 40,
		height: 30,
	}

	test("list_strokes reads an empty list when the sidecar is missing or corrupt", async () => {
		const fm = createLocalFileManager()
		readTextFile.mockRejectedValue(new Error("no such file"))
		await expect(fm.strokes.list_strokes("/board")).resolves.toEqual([])

		readTextFile.mockResolvedValue("not json {{{")
		await expect(fm.strokes.list_strokes("/board")).resolves.toEqual([])

		readTextFile.mockResolvedValue(JSON.stringify([stroke, { broken: true }]))
		await expect(fm.strokes.list_strokes("/board")).resolves.toEqual([stroke])
	})

	test("upsert/delete round-trip through an atomic tmp+rename write", async () => {
		let file_content = ""
		readTextFile.mockImplementation(() => Promise.resolve(file_content))
		writeTextFile.mockImplementation((path: string, contents: string) => {
			if (path.endsWith("/strokes.json.tmp")) file_content = contents
			return Promise.resolve()
		})

		const fm = createLocalFileManager()

		await fm.strokes.upsert_strokes("/board", [stroke])
		expect(mkdir).toHaveBeenCalledWith("/board/.pile", { recursive: true })
		expect(writeTextFile).toHaveBeenCalledWith(
			"/board/.pile/strokes.json.tmp",
			JSON.stringify([stroke]),
		)
		expect(fs_rename).toHaveBeenCalledWith(
			"/board/.pile/strokes.json.tmp",
			"/board/.pile/strokes.json",
		)

		// upsert by id replaces, order of first appearance kept
		await fm.strokes.upsert_strokes("/board", [
			{ id: "s2", z: 2, position: { x: 0, y: 0 }, points: [], color: "#0f0", stroke_width: 1, width: 5, height: 5 },
		])
		expect(JSON.parse(file_content).map((s: { id: string }) => s.id)).toEqual(["s1", "s2"])

		await fm.strokes.delete_strokes("/board", ["s1"])
		expect(JSON.parse(file_content).map((s: { id: string }) => s.id)).toEqual(["s2"])
	})

	test("watch_strokes diffs sidecar re-reads by stroke id", async () => {
		let file_content = JSON.stringify([stroke])
		readTextFile.mockImplementation(() => Promise.resolve(file_content))
		const unwatch = mock(() => {})
		fs_watch.mockResolvedValue(unwatch)

		const fm = createLocalFileManager()
		const on_event = mock<(event: { upserted: unknown[]; deleted: string[] }) => void>()
		const result = await fm.strokes.watch_strokes("/board", on_event)
		expect(result).toBe(unwatch)
		expect(fs_watch).toHaveBeenCalledWith("/board", expect.any(Function), { recursive: true })

		const tauri_cb = fs_watch.mock.calls.at(-1)![1]
		const fire = async (paths: string[]) => {
			await tauri_cb({ type: { modify: { kind: "data", mode: "content" } }, paths, attrs: {} })
			// the callback re-reads async
			await new Promise(resolve => setTimeout(resolve, 0))
		}

		// unrelated path — ignored
		await fire(["/board/other.txt"])
		expect(on_event).not.toHaveBeenCalled()

		// stroke moved (upsert) + a new stroke (insert)
		const moved = { ...stroke, position: { x: 99, y: 1 } }
		const added = { ...stroke, id: "s2", z: 2 }
		file_content = JSON.stringify([moved, added])
		await fire(["/board/.pile/strokes.json"])
		expect(on_event).toHaveBeenCalledWith({ upserted: [moved, added], deleted: [] })

		// delete
		on_event.mockClear()
		file_content = JSON.stringify([moved])
		await fire(["/board/.pile/strokes.json"])
		expect(on_event).toHaveBeenCalledWith({ upserted: [], deleted: ["s2"] })

		// no change — no event
		on_event.mockClear()
		await fire(["/board/.pile/strokes.json"])
		expect(on_event).not.toHaveBeenCalled()
	})
})

describe("local connections store (.pile/connections.json)", () => {
	beforeEach(() => {
		readTextFile.mockReset()
		writeTextFile.mockReset()
		mkdir.mockReset()
		fs_rename.mockReset()
		fs_watch.mockReset()
		fs_watch.mockResolvedValue(() => {})
	})

	const connection = {
		id: "/board/a.txt:default-/board/b.txt:default",
		from: "/board/a.txt",
		to: "/board/b.txt",
		marker_end: "arrow" as const,
		is_animated: false,
	}

	test("list_connections reads an empty list when the sidecar is missing or corrupt", async () => {
		const fm = createLocalFileManager()
		readTextFile.mockRejectedValue(new Error("no such file"))
		await expect(fm.connections.list_connections("/board")).resolves.toEqual([])

		readTextFile.mockResolvedValue("not json {{{")
		await expect(fm.connections.list_connections("/board")).resolves.toEqual([])

		readTextFile.mockResolvedValue(JSON.stringify([connection, { broken: true }]))
		await expect(fm.connections.list_connections("/board")).resolves.toEqual([connection])
	})

	test("upsert/delete round-trip through an atomic tmp+rename write", async () => {
		let file_content = ""
		readTextFile.mockImplementation(() => Promise.resolve(file_content))
		writeTextFile.mockImplementation((path: string, contents: string) => {
			if (path.endsWith("/connections.json.tmp")) file_content = contents
			return Promise.resolve()
		})

		const fm = createLocalFileManager()

		await fm.connections.upsert_connections("/board", [connection])
		expect(mkdir).toHaveBeenCalledWith("/board/.pile", { recursive: true })
		expect(writeTextFile).toHaveBeenCalledWith(
			"/board/.pile/connections.json.tmp",
			JSON.stringify([connection]),
		)
		expect(fs_rename).toHaveBeenCalledWith(
			"/board/.pile/connections.json.tmp",
			"/board/.pile/connections.json",
		)

		const second = {
			id: "/board/b.txt:default-/board/a.txt:default",
			from: "/board/b.txt",
			to: "/board/a.txt",
			is_animated: true,
		}
		await fm.connections.upsert_connections("/board", [second])
		expect(JSON.parse(file_content).map((c: { id: string }) => c.id))
			.toEqual([connection.id, second.id])

		await fm.connections.delete_connections("/board", [connection.id])
		expect(JSON.parse(file_content).map((c: { id: string }) => c.id)).toEqual([second.id])
	})

	test("watch_connections diffs sidecar re-reads by connection id", async () => {
		let file_content = JSON.stringify([connection])
		readTextFile.mockImplementation(() => Promise.resolve(file_content))
		const unwatch = mock(() => {})
		fs_watch.mockResolvedValue(unwatch)

		const fm = createLocalFileManager()
		const on_event = mock<(event: { upserted: unknown[]; deleted: string[] }) => void>()
		const result = await fm.connections.watch_connections("/board", on_event)
		expect(result).toBe(unwatch)
		expect(fs_watch).toHaveBeenCalledWith("/board", expect.any(Function), { recursive: true })

		const tauri_cb = fs_watch.mock.calls.at(-1)![1]
		const fire = async (paths: string[]) => {
			await tauri_cb({ type: { modify: { kind: "data", mode: "content" } }, paths, attrs: {} })
			// the callback re-reads async
			await new Promise(resolve => setTimeout(resolve, 0))
		}

		// unrelated path — ignored
		await fire(["/board/other.txt"])
		expect(on_event).not.toHaveBeenCalled()

		// animation toggled (upsert) + a new edge (insert)
		const toggled = { ...connection, is_animated: true }
		const added = { ...connection, id: "c2" }
		file_content = JSON.stringify([toggled, added])
		await fire(["/board/.pile/connections.json"])
		expect(on_event).toHaveBeenCalledWith({ upserted: [toggled, added], deleted: [] })

		// delete
		on_event.mockClear()
		file_content = JSON.stringify([toggled])
		await fire(["/board/.pile/connections.json"])
		expect(on_event).toHaveBeenCalledWith({ upserted: [], deleted: ["c2"] })
	})

	test("copy_entry rebases endpoint paths in copied connections.json sidecars", async () => {
		const file_entry = (name: string): DirEntry => ({
			name, isDirectory: false, isFile: true, isSymlink: false,
		})
		stat.mockResolvedValue({ isDirectory: true, isFile: false })
		const dir_entries: Record<string, DirEntry[]> = {
			"/tmp/board": [file_entry("a.txt"), file_entry("b.txt"), {
				name: ".pile", isDirectory: true, isFile: false, isSymlink: false,
			}],
			"/tmp/board/.pile": [file_entry("connections.json")],
			// the rebase pass walks the copy
			"/home/user/board": [file_entry("a.txt"), file_entry("b.txt"), {
				name: ".pile", isDirectory: true, isFile: false, isSymlink: false,
			}],
		}
		readDir.mockImplementation((path: string) => Promise.resolve(dir_entries[path] ?? []))
		list_xattrs.mockResolvedValue([])

		const sidecar = JSON.stringify([
			{
				id: "/tmp/board/a.txt:default-/tmp/board/b.txt:default",
				from: "/tmp/board/a.txt",
				to: "/tmp/board/b.txt",
				is_animated: false,
			},
			{
				id: "uuid-fallback",
				from: "/tmp/board/a.txt",
				to: "/tmp/board/b.txt",
				from_handle: "left",
				is_animated: true,
			},
		])
		readTextFile.mockImplementation((path: string) =>
			path === "/home/user/board/.pile/connections.json"
				? Promise.resolve(sidecar)
				: Promise.reject(new Error("no such file")),
		)
		let written: string | null = null
		writeTextFile.mockImplementation((path: string, contents: string) => {
			if (path === "/home/user/board/.pile/connections.json.tmp") written = contents
			return Promise.resolve()
		})

		const fm = createLocalFileManager()
		await fm.copy_entry("/tmp/board", "/home/user")

		expect(written).not.toBeNull()
		expect(JSON.parse(written!)).toEqual([
			{
				// deterministic ids embed the endpoints — re-minted onto the copy
				id: "/home/user/board/a.txt:default-/home/user/board/b.txt:default",
				from: "/home/user/board/a.txt",
				to: "/home/user/board/b.txt",
				is_animated: false,
			},
			{
				// uuid-fallback ids are globally unique — kept, endpoints rebased
				id: "uuid-fallback",
				from: "/home/user/board/a.txt",
				to: "/home/user/board/b.txt",
				from_handle: "left",
				is_animated: true,
			},
		])
	})

	const stale_board_sidecar = JSON.stringify([
		{
			id: "/tmp/board/a.txt:default-/tmp/board/b.txt:default",
			from: "/tmp/board/a.txt",
			to: "/tmp/board/b.txt",
			is_animated: false,
		},
		{
			id: "uuid-fallback",
			from: "/tmp/board/a.txt",
			to: "/tmp/board/b.txt",
			from_handle: "left",
			is_animated: true,
		},
	])

	const rebased_board = (root: string) => [
		{
			id: `${root}/a.txt:default-${root}/b.txt:default`,
			from: `${root}/a.txt`,
			to: `${root}/b.txt`,
			is_animated: false,
		},
		{
			id: "uuid-fallback",
			from: `${root}/a.txt`,
			to: `${root}/b.txt`,
			from_handle: "left",
			is_animated: true,
		},
	]

	function stub_dest_sidecar(dest_folder: string) {
		const file_entry = (name: string): DirEntry => ({
			name, isDirectory: false, isFile: true, isSymlink: false,
		})
		stat.mockResolvedValue({ isDirectory: true, isFile: false })
		readDir.mockImplementation((path: string) => Promise.resolve(
			path === dest_folder
				? [file_entry("a.txt"), file_entry("b.txt"), {
					name: ".pile", isDirectory: true, isFile: false, isSymlink: false,
				}]
				: [],
		))
		readTextFile.mockImplementation((path: string) =>
			path === `${dest_folder}/.pile/connections.json`
				? Promise.resolve(stale_board_sidecar)
				: Promise.reject(new Error("no such file")),
		)
		let written: string | null = null
		writeTextFile.mockImplementation((path: string, contents: string) => {
			if (path === `${dest_folder}/.pile/connections.json.tmp`) written = contents
			return Promise.resolve()
		})
		return () => written
	}

	test("rename rebases endpoint paths in the moved connections.json sidecar", async () => {
		const written = stub_dest_sidecar("/tmp/renamed")
		const fm = createLocalFileManager()
		await fm.rename("/tmp/board", "renamed")

		expect(written()).not.toBeNull()
		expect(JSON.parse(written()!)).toEqual(rebased_board("/tmp/renamed"))
	})

	test("move rebases endpoint paths in the moved connections.json sidecar", async () => {
		const written = stub_dest_sidecar("/home/user/board")
		const fm = createLocalFileManager()
		await fm.move("/tmp/board", "/home/user")

		expect(written()).not.toBeNull()
		expect(JSON.parse(written()!)).toEqual(rebased_board("/home/user/board"))
	})

	test("list_connections heals stale absolute endpoints onto the current folder path", async () => {
		const folder = "/Users/amatyukh/Desktop/My desktop/test"
		const stale = JSON.stringify([
			{
				id: "/Users/amatyukh/Desktop/test/a.txt:default-/Users/amatyukh/Desktop/test/b.txt:default",
				from: "/Users/amatyukh/Desktop/test/a.txt",
				to: "/Users/amatyukh/Desktop/test/b.txt",
				is_animated: false,
			},
		])
		readTextFile.mockImplementation((path: string) =>
			path === `${folder}/.pile/connections.json`
				? Promise.resolve(stale)
				: Promise.reject(new Error("no such file")),
		)
		let written: string | null = null
		writeTextFile.mockImplementation((path: string, contents: string) => {
			if (path === `${folder}/.pile/connections.json.tmp`) written = contents
			return Promise.resolve()
		})

		const fm = createLocalFileManager()
		const listed = await fm.connections.list_connections(folder)
		const healed = {
			id: `${folder}/a.txt:default-${folder}/b.txt:default`,
			from: `${folder}/a.txt`,
			to: `${folder}/b.txt`,
			is_animated: false,
		}
		expect(listed).toEqual([healed])
		expect(written).not.toBeNull()
		expect(JSON.parse(written!)).toEqual([healed])
	})
})

describe("map_tauri_watch_event", () => {
	test("maps create / remove / modify / rename / other kinds", () => {
		expect(map_tauri_watch_event({
			type: { create: { kind: "folder" } },
			paths: ["/a"],
			attrs: {},
		})).toEqual({ kind: "create", ids: ["/a"] })

		expect(map_tauri_watch_event({
			type: { remove: { kind: "file" } },
			paths: ["/a", "/b"],
			attrs: {},
		})).toEqual({ kind: "remove", ids: ["/a", "/b"] })

		expect(map_tauri_watch_event({
			type: { modify: { kind: "data", mode: "content" } },
			paths: ["/a"],
			attrs: {},
		})).toEqual({ kind: "modify", ids: ["/a"] })

		expect(map_tauri_watch_event({
			type: { modify: { kind: "rename", mode: "both" } },
			paths: ["/old", "/new"],
			attrs: {},
		})).toEqual({ kind: "rename", ids: ["/old", "/new"] })

		expect(map_tauri_watch_event({
			type: { access: { kind: "open", mode: "read" } },
			paths: ["/a"],
			attrs: {},
		})).toEqual({ kind: "other", ids: ["/a"] })

		expect(map_tauri_watch_event({
			type: "any",
			paths: ["/a"],
			attrs: {},
		})).toEqual({ kind: "other", ids: ["/a"] })

		expect(map_tauri_watch_event({
			type: "other",
			paths: ["/a"],
			attrs: {},
		})).toEqual({ kind: "other", ids: ["/a"] })
	})
})

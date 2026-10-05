import { describe, expect, test } from "bun:test"
import { createBrowserFileManager } from "./browser"
import {
	createMemoryBrowserStorage,
	type BrowserStorage,
} from "./storage"
import type { FolderConnection, FolderStroke } from "../types"

const ROOT = "/browser-desktops/d1"

function seeded_storage(): BrowserStorage {
	return createMemoryBrowserStorage()
}

/** Mirrors the client's ensure_browser_desktop_root, then opens the FM. */
async function create_ready(storage: BrowserStorage) {
	await storage.apply({
		entries: [
			{ path: "/browser-desktops", type: "folder", xattrs: {} },
			{ path: ROOT, type: "folder", xattrs: {} },
		],
	})
	return createBrowserFileManager(storage)
}

const stroke = (id: string, z = 1): FolderStroke => ({
	id,
	z,
	position: { x: 0, y: 0 },
	points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
	color: "#000",
	stroke_width: 2,
	width: 20,
	height: 20,
})

const connection = (id: string, from: string, to: string): FolderConnection => ({
	id,
	from,
	to,
	is_animated: false,
})

describe("browser FileManager", () => {
	test("CRUD roundtrip", async () => {
		const fm = await create_ready(seeded_storage())

		await fm.create_folder(ROOT, "docs")
		await fm.create_text_file(`${ROOT}/docs`, "note.md")
		await fm.save_text_file(`${ROOT}/docs/note.md`, "hello")

		const children = await fm.FolderChildren(`${ROOT}/docs`)
		expect(children).toEqual([{ id: `${ROOT}/docs/note.md`, type: "file", name: "note.md" }])
		expect(await fm.read_text_file(`${ROOT}/docs/note.md`)).toBe("hello")

		await fm.set_xattr(`${ROOT}/docs/note.md`, "position", '{"x":1,"y":2}')
		expect(await fm.get_xattr(`${ROOT}/docs/note.md`, "position")).toBe('{"x":1,"y":2}')
		await fm.remove_xattr(`${ROOT}/docs/note.md`, "position")
		expect(await fm.get_xattr(`${ROOT}/docs/note.md`, "position")).toBeNull()

		await fm.remove(`${ROOT}/docs`)
		expect(await fm.FolderChildren(ROOT)).toEqual([])
	})

	test("create writes content and xattrs that survive reload", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)

		await fm.create_folder(ROOT, "board", { xattrs: { position: '{"x":10,"y":20}' } })
		await fm.create_text_file(`${ROOT}/board`, "Note 1.md", {
			content: "hello",
			xattrs: { is_preview: "true", position: '{"x":30,"y":40}' },
		})

		const reloaded = createBrowserFileManager(storage)
		expect(await reloaded.get_xattr(`${ROOT}/board`, "position")).toBe('{"x":10,"y":20}')
		expect(await reloaded.read_text_file(`${ROOT}/board/Note 1.md`)).toBe("hello")
		expect(await reloaded.get_xattr(`${ROOT}/board/Note 1.md`, "is_preview")).toBe("true")
		expect(await reloaded.get_xattr(`${ROOT}/board/Note 1.md`, "position")).toBe('{"x":30,"y":40}')
	})

	test("a second instance over the same storage sees the first one's data (reload)", async () => {
		const storage = seeded_storage()
		const first = await create_ready(storage)
		await first.create_folder(ROOT, "docs")
		await first.create_text_file(`${ROOT}/docs`, "note.md")
		await first.save_text_file(`${ROOT}/docs/note.md`, "persisted")
		await first.set_xattr(`${ROOT}/docs`, "position", '{"x":3,"y":4}')

		const second = createBrowserFileManager(storage)
		expect(await second.read_text_file(`${ROOT}/docs/note.md`)).toBe("persisted")
		expect(await second.get_xattr(`${ROOT}/docs`, "position")).toBe('{"x":3,"y":4}')
		const children = await second.FolderChildren(ROOT)
		expect(children.map(c => c.name)).toEqual(["docs"])
	})

	test("rename persists the whole subtree atomically", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "docs")
		await fm.create_folder(`${ROOT}/docs`, "inner")
		await fm.create_text_file(`${ROOT}/docs/inner`, "deep.md")
		await fm.save_text_file(`${ROOT}/docs/inner/deep.md`, "deep content")
		await fm.set_xattr(`${ROOT}/docs/inner/deep.md`, "position", '{"x":5,"y":6}')

		await fm.rename(`${ROOT}/docs`, "papers")

		const reloaded = createBrowserFileManager(storage)
		expect(await reloaded.read_text_file(`${ROOT}/papers/inner/deep.md`)).toBe("deep content")
		expect(await reloaded.get_xattr(`${ROOT}/papers/inner/deep.md`, "position")).toBe('{"x":5,"y":6}')
		// nothing remains under the old prefix
		expect((await storage.children_paths(ROOT)).map(p => p.slice(ROOT.length + 1))).toEqual(["papers"])
	})

	test("move persists the subtree under the new parent", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "docs")
		await fm.create_text_file(`${ROOT}/docs`, "note.md")
		await fm.create_folder(ROOT, "archive")

		await fm.move(`${ROOT}/docs`, `${ROOT}/archive`)

		const reloaded = createBrowserFileManager(storage)
		expect(await reloaded.FolderChildren(`${ROOT}/archive/docs`)).toHaveLength(1)
		expect((await reloaded.FolderChildren(ROOT)).map(c => c.name)).toEqual(["archive"])
	})

	test("copy_entry persists a durable duplicate incl. blobs and xattrs", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "src")
		await fm.upload_file(`${ROOT}/src`, "photo.png", new Blob(["png-bytes"], { type: "image/png" }))
		await fm.set_xattr(`${ROOT}/src/photo.png`, "position", '{"x":7,"y":8}')

		await fm.copy_entry(`${ROOT}/src`, ROOT, "copy")

		const reloaded = createBrowserFileManager(storage)
		const copied = await reloaded.get_media_src(`${ROOT}/copy/photo.png`)
		const response = await fetch(copied.url)
		expect(await response.text()).toBe("png-bytes")
		copied.revoke?.()
		expect(await reloaded.get_xattr(`${ROOT}/copy/photo.png`, "position")).toBe('{"x":7,"y":8}')
		// the source is untouched
		expect((await reloaded.FolderChildren(`${ROOT}/src`)).map(c => c.name)).toEqual(["photo.png"])
	})

	test("remove wipes entries, blobs and folder docs of the subtree", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "docs")
		await fm.upload_file(`${ROOT}/docs`, "photo.png", new Blob(["png-bytes"]))
		await fm.strokes.upsert_strokes(`${ROOT}/docs`, [stroke("s1")])
		await fm.connections.upsert_connections(`${ROOT}/docs`, [connection("c1", "a", "b")])

		await fm.remove(`${ROOT}/docs`)

		const snapshot = await storage.load_all()
		expect(snapshot.entries.filter(e => e.path.startsWith(`${ROOT}/docs`))).toEqual([])
		expect(snapshot.blobs.filter(b => b.path.startsWith(`${ROOT}/docs`))).toEqual([])
		expect(snapshot.strokes.filter(s => s.folder.startsWith(`${ROOT}/docs`))).toEqual([])
		expect(snapshot.connections.filter(c => c.folder.startsWith(`${ROOT}/docs`))).toEqual([])
	})

	test("remove of `ab` keeps the sibling `ab2`", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "ab")
		await fm.create_folder(ROOT, "ab2")
		await fm.create_text_file(`${ROOT}/ab2`, "keep.md")

		await fm.remove(`${ROOT}/ab`)

		const reloaded = createBrowserFileManager(storage)
		expect(await reloaded.FolderChildren(`${ROOT}/ab2`)).toHaveLength(1)
	})

	test("strokes and connections survive a reload", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "board")
		await fm.strokes.upsert_strokes(`${ROOT}/board`, [stroke("s1"), stroke("s2", 2)])
		await fm.connections.upsert_connections(`${ROOT}/board`, [connection("c1", "a", "b")])

		const reloaded = createBrowserFileManager(storage)
		expect((await reloaded.strokes.list_strokes(`${ROOT}/board`)).map(s => s.id)).toEqual(["s1", "s2"])
		expect((await reloaded.connections.list_connections(`${ROOT}/board`)).map(c => c.id)).toEqual(["c1"])
	})

	test("strokes travel with a renamed folder", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "board")
		await fm.strokes.upsert_strokes(`${ROOT}/board`, [stroke("s1")])

		await fm.rename(`${ROOT}/board`, "canvas")

		const reloaded = createBrowserFileManager(storage)
		expect((await reloaded.strokes.list_strokes(`${ROOT}/canvas`)).map(s => s.id)).toEqual(["s1"])
	})

	test("upload → get_media_src roundtrips the blob after reload", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		const data = new Blob(["binary-payload"], { type: "application/octet-stream" })
		await fm.upload_file(ROOT, "blob.bin", data)

		const reloaded = createBrowserFileManager(storage)
		const src = await reloaded.get_media_src(`${ROOT}/blob.bin`)
		expect(src.url.startsWith("blob:")).toBe(true)
		const response = await fetch(src.url)
		expect(await response.text()).toBe("binary-payload")
		src.revoke?.()
	})

	test("save_text_file over a blob-backed file drops the blob durably", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.upload_file(ROOT, "note.md", new Blob(["original"]))

		await fm.save_text_file(`${ROOT}/note.md`, "edited text")

		const snapshot = await storage.load_all()
		expect(snapshot.blobs.filter(b => b.path === `${ROOT}/note.md`)).toEqual([])
		const reloaded = createBrowserFileManager(storage)
		expect(await reloaded.read_text_file(`${ROOT}/note.md`)).toBe("edited text")
	})

	test("a storage failure rejects the mutation", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		const failing: BrowserStorage = {
			...storage,
			apply: async () => {
				throw new Error("QuotaExceededError")
			},
		}
		const failing_fm = createBrowserFileManager(failing)
		await failing_fm.FolderChildren(ROOT) // hydrate

		await expect(failing_fm.create_folder(ROOT, "nope")).rejects.toThrow("QuotaExceededError")
	})

	test("children_paths lists immediate children only", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "docs")
		await fm.create_folder(`${ROOT}/docs`, "inner")
		await fm.create_text_file(ROOT, "top.md")

		const children = await storage.children_paths(ROOT)
		expect(children.sort()).toEqual([`${ROOT}/docs`, `${ROOT}/top.md`])
		expect(await storage.has(`${ROOT}/docs`)).toBe(true)
		expect(await storage.has(`${ROOT}/missing`)).toBe(false)
	})

	test("set_xattrs persists the applied entries in one write", async () => {
		const storage = seeded_storage()
		const fm = await create_ready(storage)
		await fm.create_folder(ROOT, "docs")
		await fm.create_text_file(`${ROOT}/docs`, "note.md")

		let applies = 0
		const counting: BrowserStorage = {
			...storage,
			apply: async (write) => {
				applies += 1
				return storage.apply(write)
			},
		}
		const counted = createBrowserFileManager(counting)
		const result = await counted.set_xattrs([
			{ id: `${ROOT}/docs`, xattrs: { view: "board" } },
			{ id: `${ROOT}/docs/note.md`, xattrs: { position: '{"x":1,"y":2}' } },
			{ id: `${ROOT}/gone.md`, xattrs: { order: "0" } },
		])

		expect(result.missing).toEqual([`${ROOT}/gone.md`])
		expect(applies).toBe(1)
		const reloaded = createBrowserFileManager(storage)
		expect(await reloaded.get_xattr(`${ROOT}/docs`, "view")).toBe("board")
		expect(await reloaded.get_xattr(`${ROOT}/docs/note.md`, "position")).toBe('{"x":1,"y":2}')
	})
})

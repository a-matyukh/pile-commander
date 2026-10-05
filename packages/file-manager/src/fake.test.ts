import { describe, expect, test } from "bun:test"
import { createFakeFileManager } from "./fake"
import type { ConnectionsWatchEvent, FolderConnection, FolderStroke, StrokesWatchEvent } from "./types"

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

describe("fake FileManager strokes store", () => {
	test("list/upsert/delete round-trip, sorted by z", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")

		await fake.fm.strokes.upsert_strokes("/board", [stroke("b", 2), stroke("a", 1)])
		expect((await fake.fm.strokes.list_strokes("/board")).map(s => s.id)).toEqual(["a", "b"])

		await fake.fm.strokes.upsert_strokes("/board", [{ ...stroke("a", 1), color: "#f00" }])
		const listed = await fake.fm.strokes.list_strokes("/board")
		expect(listed.find(s => s.id === "a")?.color).toBe("#f00")
		expect(listed).toHaveLength(2)

		await fake.fm.strokes.delete_strokes("/board", ["a"])
		expect((await fake.fm.strokes.list_strokes("/board")).map(s => s.id)).toEqual(["b"])
	})

	test("writes notify strokes watchers; unwatch detaches", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")

		const events: StrokesWatchEvent[] = []
		const unwatch = await fake.fm.strokes.watch_strokes("/board", e => events.push(e))

		await fake.fm.strokes.upsert_strokes("/board", [stroke("a")])
		await fake.fm.strokes.delete_strokes("/board", ["a"])
		// deleting a missing id is a no-op (no event)
		await fake.fm.strokes.delete_strokes("/board", ["missing"])

		expect(events).toEqual([
			{ upserted: [stroke("a")], deleted: [] },
			{ upserted: [], deleted: ["a"] },
		])

		unwatch()
		await fake.fm.strokes.upsert_strokes("/board", [stroke("c")])
		expect(events).toHaveLength(2)
	})

	test("emit_strokes_event simulates a remote client", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")
		fake.seed_strokes("/board", [stroke("a")])

		const events: StrokesWatchEvent[] = []
		await fake.fm.strokes.watch_strokes("/board", e => events.push(e))

		fake.emit_strokes_event("/board", { upserted: [stroke("b", 2)], deleted: ["a"] })
		expect(events).toEqual([{ upserted: [stroke("b", 2)], deleted: ["a"] }])
	})

	test("ink travels with the folder on rename/move/copy and dies on remove", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/")
		fake.seed_folder("/board")
		fake.seed_folder("/elsewhere")
		fake.seed_strokes("/board", [stroke("a")])

		await fake.fm.rename("/board", "renamed")
		expect(await fake.fm.strokes.list_strokes("/renamed")).toEqual([stroke("a")])

		await fake.fm.move("/renamed", "/elsewhere")
		expect(await fake.fm.strokes.list_strokes("/elsewhere/renamed")).toEqual([stroke("a")])

		await fake.fm.copy_entry("/elsewhere/renamed", "/")
		expect(await fake.fm.strokes.list_strokes("/renamed")).toEqual([stroke("a")])

		await fake.fm.remove("/elsewhere")
		expect(fake.has("/elsewhere")).toBe(false)
		// removed subtree strokes are gone — list now fails like any missing entry
		expect(fake.fm.strokes.list_strokes("/elsewhere/renamed")).rejects.toThrow()
	})
})

const edge = (id: string, from: string, to: string): FolderConnection => ({
	id,
	from,
	to,
	is_animated: false,
})

describe("fake FileManager connections store", () => {
	test("list/upsert/delete round-trip", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")
		fake.seed_file("/board/a.txt")
		fake.seed_file("/board/b.txt")

		await fake.fm.connections.upsert_connections("/board", [
			edge("a:default-b:default", "/board/a.txt", "/board/b.txt"),
		])
		expect((await fake.fm.connections.list_connections("/board")).map(c => c.id))
			.toEqual(["a:default-b:default"])

		// upsert by id replaces (markers/animation toggle)
		await fake.fm.connections.upsert_connections("/board", [
			{ ...edge("a:default-b:default", "/board/a.txt", "/board/b.txt"), marker_end: "arrow" as const, is_animated: true },
		])
		const listed = await fake.fm.connections.list_connections("/board")
		expect(listed).toHaveLength(1)
		expect(listed[0]).toMatchObject({ marker_end: "arrow", is_animated: true })

		await fake.fm.connections.delete_connections("/board", ["a:default-b:default"])
		expect(await fake.fm.connections.list_connections("/board")).toEqual([])
	})

	test("writes notify connections watchers; unwatch detaches", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")
		fake.seed_file("/board/a.txt")
		fake.seed_file("/board/b.txt")

		const events: ConnectionsWatchEvent[] = []
		const unwatch = await fake.fm.connections.watch_connections("/board", e => events.push(e))

		await fake.fm.connections.upsert_connections("/board", [edge("c1", "/board/a.txt", "/board/b.txt")])
		await fake.fm.connections.delete_connections("/board", ["c1"])
		// deleting a missing id is a no-op (no event)
		await fake.fm.connections.delete_connections("/board", ["missing"])

		expect(events).toEqual([
			{ upserted: [edge("c1", "/board/a.txt", "/board/b.txt")], deleted: [] },
			{ upserted: [], deleted: ["c1"] },
		])

		unwatch()
		await fake.fm.connections.upsert_connections("/board", [edge("c2", "/board/a.txt", "/board/b.txt")])
		expect(events).toHaveLength(2)
	})

	test("emit_connections_event simulates a remote client", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")
		fake.seed_file("/board/a.txt")
		fake.seed_file("/board/b.txt")
		fake.seed_connections("/board", [edge("c1", "/board/a.txt", "/board/b.txt")])

		const events: ConnectionsWatchEvent[] = []
		await fake.fm.connections.watch_connections("/board", e => events.push(e))

		fake.emit_connections_event("/board", {
			upserted: [edge("c2", "/board/b.txt", "/board/a.txt")],
			deleted: ["c1"],
		})
		expect(events).toEqual([{ upserted: [edge("c2", "/board/b.txt", "/board/a.txt")], deleted: ["c1"] }])
	})

	test("connections travel with the folder on rename/move and die on remove", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/")
		fake.seed_folder("/board")
		fake.seed_folder("/elsewhere")
		fake.seed_file("/board/a.txt")
		fake.seed_file("/board/b.txt")
		fake.seed_connections("/board", [edge("c1", "/board/a.txt", "/board/b.txt")])

		await fake.fm.rename("/board", "renamed")
		expect(await fake.fm.connections.list_connections("/renamed"))
			.toEqual([edge("c1", "/renamed/a.txt", "/renamed/b.txt")])

		await fake.fm.move("/renamed", "/elsewhere")
		expect(await fake.fm.connections.list_connections("/elsewhere/renamed"))
			.toEqual([edge("c1", "/elsewhere/renamed/a.txt", "/elsewhere/renamed/b.txt")])

		await fake.fm.remove("/elsewhere")
		expect(fake.fm.connections.list_connections("/elsewhere/renamed")).rejects.toThrow()
	})

	test("list_connections heals stale endpoints after the folder was moved externally", async () => {
		const fake = createFakeFileManager()
		const dest = "/Users/amatyukh/Desktop/My desktop/test"
		fake.seed_folder("/Users/amatyukh/Desktop")
		fake.seed_folder("/Users/amatyukh/Desktop/My desktop")
		fake.seed_folder(dest)
		fake.seed_file(`${dest}/a.txt`)
		fake.seed_file(`${dest}/b.txt`)
		fake.seed_connections(dest, [edge("c1", "/Users/amatyukh/Desktop/test/a.txt", "/Users/amatyukh/Desktop/test/b.txt")])

		expect(await fake.fm.connections.list_connections(dest)).toEqual([
			edge("c1", `${dest}/a.txt`, `${dest}/b.txt`),
		])
	})

	test("copy rebases endpoints and re-mints deterministic ids", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/")
		fake.seed_folder("/board")
		fake.seed_file("/board/a.txt")
		fake.seed_file("/board/b.txt")
		fake.seed_connections("/board", [
			{
				...edge("/board/a.txt:top-/board/b.txt:default", "/board/a.txt", "/board/b.txt"),
				from_handle: "top" as const,
			},
			{ ...edge("uuid-fallback", "/board/a.txt", "/board/b.txt"), from_handle: "left" as const },
		])

		await fake.fm.copy_entry("/board", "/", "clone")

		expect(await fake.fm.connections.list_connections("/clone")).toEqual([
			{
				...edge("/clone/a.txt:top-/clone/b.txt:default", "/clone/a.txt", "/clone/b.txt"),
				from_handle: "top",
			},
			// uuid-fallback ids are globally unique — kept, endpoints rebased
			{ ...edge("uuid-fallback", "/clone/a.txt", "/clone/b.txt"), from_handle: "left" },
		])
		// the source is untouched
		expect(await fake.fm.connections.list_connections("/board")).toEqual([
			{
				...edge("/board/a.txt:top-/board/b.txt:default", "/board/a.txt", "/board/b.txt"),
				from_handle: "top",
			},
			{ ...edge("uuid-fallback", "/board/a.txt", "/board/b.txt"), from_handle: "left" },
		])
	})
})

describe("fake FileManager bulk xattrs and sizes", () => {
	test("set_xattrs merges per entry and reports missing ids", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")
		fake.seed_file("/board/a.txt")
		fake.set_xattr("/board/a.txt", "order", "0")

		const result = await fake.fm.set_xattrs([
			{ id: "/board/a.txt", xattrs: { position: "{}" } },
			{ id: "/board/gone.txt", xattrs: { order: "1" } },
		])

		expect(result.missing).toEqual(["/board/gone.txt"])
		expect(fake.get_xattr("/board/a.txt", "order")).toBe("0")
		expect(fake.get_xattr("/board/a.txt", "position")).toBe("{}")
	})

	test("entry_size counts text bytes, blob bytes and 0 for folders", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/board")
		fake.seed_file("/board/note.md", "привет")
		await fake.fm.upload_file("/board", "photo.png", new Blob(["png-bytes"]))

		expect(await fake.fm.entry_size("/board")).toBe(0)
		expect(await fake.fm.entry_size("/board/note.md")).toBe(12)
		expect(await fake.fm.entry_size("/board/photo.png")).toBe(9)
	})
})

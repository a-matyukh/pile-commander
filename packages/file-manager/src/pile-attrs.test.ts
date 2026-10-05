import { describe, expect, test } from "bun:test"
import { createFakeFileManager } from "./fake"
import {
	CANVAS_ATTR,
	PILE_ATTRS_VERSION,
	STROKES_ATTR,
	applyPileAttrs,
	collectPileAttrs,
	parsePileAttrsManifest,
	parse_packed_connections,
	parse_packed_strokes,
	serializePileAttrsManifest,
} from "./pile-attrs"
import type { FolderConnection, FolderStroke } from "./types"

const test_stroke: FolderStroke = {
	id: "s1",
	z: 1,
	position: { x: 10, y: 20 },
	points: [{ x: 0, y: 0 }, { x: 5.25, y: 7.5 }],
	color: "#f00",
	stroke_width: 3,
	width: 40,
	height: 30,
}

describe("parsePileAttrsManifest", () => {
	test("parses a valid manifest", () => {
		const manifest = parsePileAttrsManifest({
			version: 1,
			attrs: {
				"": { view: "board" },
				"Notes/a.txt": { order: "0", position: "{\"x\":1,\"y\":2}" },
			},
		})
		expect(manifest.version).toBe(1)
		expect(manifest.attrs[""]).toEqual({ view: "board" })
		expect(manifest.attrs["Notes/a.txt"]).toEqual({
			order: "0",
			position: "{\"x\":1,\"y\":2}",
		})
	})

	test("rejects missing version", () => {
		expect(() => parsePileAttrsManifest({ attrs: {} })).toThrow(/version/)
	})

	test("rejects non-string attr values", () => {
		expect(() =>
			parsePileAttrsManifest({
				version: 1,
				attrs: { "": { view: 1 } },
			}),
		).toThrow(/must be a string/)
	})
})

describe("collectPileAttrs / applyPileAttrs", () => {
	test("round-trips layout attrs and skips .pile", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/ws")
		fake.seed_folder("/ws/Notes")
		fake.seed_file("/ws/Notes/a.txt", "hello")
		fake.seed_folder("/ws/.pile")
		fake.seed_file("/ws/.pile/attrs.json", "{}")
		fake.set_xattr("/ws", "view", "board")
		fake.set_xattr("/ws/Notes", "is_preview", "true")
		fake.set_xattr("/ws/Notes/a.txt", "order", "0")
		fake.set_xattr("/ws/.pile", "ignore", "me")

		const collected = await collectPileAttrs(fake.fm, "/ws")
		expect(collected.version).toBe(PILE_ATTRS_VERSION)
		expect(collected.attrs).toEqual({
			"": { view: "board" },
			Notes: { is_preview: "true" },
			"Notes/a.txt": { order: "0" },
		})
		expect(collected.attrs[".pile"]).toBeUndefined()

		const dest = createFakeFileManager()
		dest.seed_folder("/out")
		dest.seed_folder("/out/Notes")
		dest.seed_file("/out/Notes/a.txt", "hello")

		const result = await applyPileAttrs(dest.fm, "/out", collected)
		expect(result.missing).toEqual([])
		expect(dest.get_xattr("/out", "view")).toBe("board")
		expect(dest.get_xattr("/out/Notes", "is_preview")).toBe("true")
		expect(dest.get_xattr("/out/Notes/a.txt", "order")).toBe("0")
	})

	test("reports missing paths without throwing", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/out")

		const result = await applyPileAttrs(fake.fm, "/out", {
			version: 1,
			attrs: {
				"": { view: "board" },
				"gone.txt": { order: "1" },
			},
		})

		expect(result.missing).toEqual(["gone.txt"])
		expect(fake.get_xattr("/out", "view")).toBe("board")
	})

	test("serialize then parse preserves attrs", () => {
		const original = {
			version: 1,
			attrs: { "": { view: "list" } },
		}
		const round_trip = parsePileAttrsManifest(
			JSON.parse(serializePileAttrsManifest(original)),
		)
		expect(round_trip).toEqual(original)
	})

	test("folder ink round-trips through the manifest 'strokes' key", async () => {
		const source = createFakeFileManager()
		source.seed_folder("/ws")
		source.seed_folder("/ws/board")
		source.seed_strokes("/ws/board", [test_stroke])

		const collected = await collectPileAttrs(source.fm, "/ws")
		expect(JSON.parse(collected.attrs["board"]![STROKES_ATTR]!)).toEqual([test_stroke])

		const dest = createFakeFileManager()
		dest.seed_folder("/out")
		dest.seed_folder("/out/board")

		const result = await applyPileAttrs(dest.fm, "/out", collected)
		expect(result.missing).toEqual([])
		// routed to entity storage, not to an xattr
		expect(await dest.fm.strokes.list_strokes("/out/board")).toEqual([test_stroke])
		expect(dest.get_xattr("/out/board", STROKES_ATTR)).toBeNull()
	})

	test("folder edges round-trip through the manifest 'canvas' key, rebased onto the new root", async () => {
		const source = createFakeFileManager()
		source.seed_folder("/ws")
		source.seed_folder("/ws/board")
		source.seed_file("/ws/board/a.txt", "a")
		source.seed_file("/ws/board/b.txt", "b")
		source.seed_connections("/ws/board", [
			{
				id: "/ws/board/a.txt:default-/ws/board/b.txt:default",
				from: "/ws/board/a.txt",
				to: "/ws/board/b.txt",
				marker_end: "arrow",
				is_animated: true,
			},
		])

		const collected = await collectPileAttrs(source.fm, "/ws")
		// endpoints are packed root-relative so the import root can differ
		expect(JSON.parse(collected.attrs["board"]![CANVAS_ATTR]!)).toEqual({
			connections: [{
				id: "board/a.txt:default-board/b.txt:default",
				from: "board/a.txt",
				to: "board/b.txt",
				marker_end: "arrow",
				is_animated: true,
			}],
		})

		const dest = createFakeFileManager()
		dest.seed_folder("/out")
		dest.seed_folder("/out/board")
		dest.seed_file("/out/board/a.txt", "a")
		dest.seed_file("/out/board/b.txt", "b")

		const result = await applyPileAttrs(dest.fm, "/out", collected)
		expect(result.missing).toEqual([])
		// routed to entity storage, not to an xattr; endpoints + deterministic
		// id rebased onto the destination root
		expect(await dest.fm.connections.list_connections("/out/board")).toEqual([
			{
				id: "/out/board/a.txt:default-/out/board/b.txt:default",
				from: "/out/board/a.txt",
				to: "/out/board/b.txt",
				marker_end: "arrow",
				is_animated: true,
			},
		])
		expect(dest.get_xattr("/out/board", CANVAS_ATTR)).toBeNull()
	})
})

describe("pile attrs on a cloud-style root /", () => {
	test("applies nested attrs and rebases edges onto the root", async () => {
		const source = createFakeFileManager()
		source.seed_folder("/ws")
		source.seed_folder("/ws/board")
		source.seed_file("/ws/board/a.txt", "a")
		source.seed_file("/ws/board/b.txt", "b")
		source.set_xattr("/ws", "view", "board")
		source.set_xattr("/ws/board", "is_preview", "true")
		source.set_xattr("/ws/board/a.txt", "position", "{\"x\":1,\"y\":2}")
		source.seed_connections("/ws/board", [{
			id: "/ws/board/a.txt:default-/ws/board/b.txt:default",
			from: "/ws/board/a.txt",
			to: "/ws/board/b.txt",
			is_animated: false,
		}])

		const collected = await collectPileAttrs(source.fm, "/ws")

		const dest = createFakeFileManager()
		dest.seed_folder("/")
		dest.seed_folder("/board")
		dest.seed_file("/board/a.txt", "a")
		dest.seed_file("/board/b.txt", "b")

		const result = await applyPileAttrs(dest.fm, "/", collected)
		expect(result.missing).toEqual([])
		expect(dest.get_xattr("/", "view")).toBe("board")
		expect(dest.get_xattr("/board", "is_preview")).toBe("true")
		expect(dest.get_xattr("/board/a.txt", "position")).toBe("{\"x\":1,\"y\":2}")
		expect(await dest.fm.connections.list_connections("/board")).toEqual([{
			id: "/board/a.txt:default-/board/b.txt:default",
			from: "/board/a.txt",
			to: "/board/b.txt",
			is_animated: false,
		}])
	})

	test("collects from the root with root-relative keys", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/")
		fake.seed_folder("/board")
		fake.seed_file("/board/a.txt", "a")
		fake.set_xattr("/", "view", "board")
		fake.set_xattr("/board/a.txt", "order", "0")

		const collected = await collectPileAttrs(fake.fm, "/")
		expect(collected.attrs).toEqual({
			"": { view: "board" },
			"board/a.txt": { order: "0" },
		})
	})
})

describe("collectPileAttrs / applyPileAttrs round-trips", () => {
	test("collect reads each folder once and skips .pile at any depth", async () => {
		const fake = createFakeFileManager()
		fake.seed_folder("/ws")
		fake.seed_folder("/ws/board")
		fake.seed_file("/ws/board/a.txt", "a")
		fake.seed_folder("/ws/board/.pile")
		fake.set_xattr("/ws/board/.pile", "ignore", "me")
		fake.set_xattr("/ws/board/a.txt", "order", "0")

		const collected = await collectPileAttrs(fake.fm, "/ws")
		expect(collected.attrs).toEqual({ "board/a.txt": { order: "0" } })
		expect(fake.calls.filter(c => c.method === "folder_with_children_xattrs").map(c => c.args[0]))
			.toEqual(["/ws", "/ws/board"])
		expect(fake.calls.some(c => c.method === "list_xattrs")).toBe(false)
	})

	test("apply writes plain attrs in one set_xattrs batch", async () => {
		const dest = createFakeFileManager()
		dest.seed_folder("/out")
		dest.seed_file("/out/a.txt")
		dest.seed_file("/out/b.txt")

		const result = await applyPileAttrs(dest.fm, "/out", {
			version: 1,
			attrs: {
				"a.txt": { order: "0", position: "{}" },
				"b.txt": { order: "1" },
			},
		})

		expect(result.missing).toEqual([])
		expect(dest.calls.filter(c => c.method === "set_xattrs")).toHaveLength(1)
		expect(dest.calls.some(c => c.method === "set_xattr")).toBe(false)
		expect(dest.get_xattr("/out/a.txt", "position")).toBe("{}")
		expect(dest.get_xattr("/out/b.txt", "order")).toBe("1")
	})

	test("fresh_stroke_ids re-mints ink ids and skips folders that already hold ink", async () => {
		const manifest = {
			version: 1,
			attrs: { board: { [STROKES_ATTR]: JSON.stringify([test_stroke]) } },
		}
		const dest = createFakeFileManager()
		dest.seed_folder("/")
		dest.seed_folder("/board")

		const result = await applyPileAttrs(dest.fm, "/", manifest, { fresh_stroke_ids: true })
		expect(result.missing).toEqual([])
		const first = await dest.fm.strokes.list_strokes("/board")
		expect(first).toHaveLength(1)
		expect(first[0]!.id).not.toBe(test_stroke.id)
		expect({ ...first[0]!, id: test_stroke.id }).toEqual(test_stroke)

		// a retried apply leaves the folder's ink alone
		await applyPileAttrs(dest.fm, "/", manifest, { fresh_stroke_ids: true })
		expect(await dest.fm.strokes.list_strokes("/board")).toEqual(first)
	})
})

describe("parse_packed_connections", () => {
	const packed: FolderConnection = {
		id: "board/a.txt:default-board/b.txt:default",
		from: "board/a.txt",
		to: "board/b.txt",
		from_handle: "top",
		marker_end: "arrowclosed",
		is_animated: true,
	}

	test("parses the current { connections: [...] } payload", () => {
		expect(parse_packed_connections(JSON.stringify({ connections: [packed] }))).toEqual([packed])
	})

	test("parses a bare array payload", () => {
		expect(parse_packed_connections(JSON.stringify([packed]))).toEqual([packed])
	})

	test("drops invalid entries and normalizes unknown handles/markers", () => {
		const parsed = parse_packed_connections(JSON.stringify({
			connections: [
				packed,
				{ id: "bad", from: "a" },
				{ ...packed, id: "c2", from_handle: "diagonal", marker_end: "diamond" },
			],
		}))
		expect(parsed).toEqual([
			packed,
			{
				id: "c2",
				from: packed.from,
				to: packed.to,
				from_handle: undefined,
				to_handle: undefined,
				marker_start: undefined,
				marker_end: undefined,
				is_animated: true,
			},
		])
	})

	test("garbage in, empty out", () => {
		expect(parse_packed_connections("not json")).toEqual([])
		expect(parse_packed_connections("{}")).toEqual([])
		expect(parse_packed_connections(JSON.stringify({ connections: "nope" }))).toEqual([])
	})

	test("keeps a non-empty label and drops empty ones", () => {
		const withLabel = { ...packed, label: "Square marker" }
		expect(parse_packed_connections(JSON.stringify({ connections: [withLabel] }))).toEqual([withLabel])
		expect(parse_packed_connections(JSON.stringify({ connections: [{ ...packed, label: "" }] }))).toEqual([packed])
		expect(parse_packed_connections(JSON.stringify({ connections: [{ ...packed, label: 1 }] }))).toEqual([packed])
	})
})

describe("parse_packed_strokes", () => {
	test("parses the current FolderStroke payload", () => {
		expect(parse_packed_strokes(JSON.stringify([test_stroke]))).toEqual([test_stroke])
	})

	test("legacy xattr payload: no z, type tag — z falls back to the index", () => {
		const legacy = [
			{
				id: "a",
				type: "stroke",
				position: { x: 1, y: 2 },
				points: [{ x: 0, y: 0 }],
				color: "#000",
				stroke_width: 2,
				width: 10,
				height: 10,
			},
		]
		expect(parse_packed_strokes(JSON.stringify(legacy))).toEqual([
			{ ...test_stroke, id: "a", z: 0, position: { x: 1, y: 2 }, points: [{ x: 0, y: 0 }], color: "#000", stroke_width: 2, width: 10, height: 10 },
		])
	})

	test("garbage in, empty out", () => {
		expect(parse_packed_strokes("not json")).toEqual([])
		expect(parse_packed_strokes("{}")).toEqual([])
		expect(parse_packed_strokes(JSON.stringify([{ id: 1 }, null, "x"]))).toEqual([])
	})
})

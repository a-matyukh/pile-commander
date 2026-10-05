import { describe, expect, test } from "bun:test"
import { createDemoFileManager, createDemoFileManagerFrom } from "./demo"

describe("createDemoFileManager", () => {
	test("keeps the original board and adds ProductFrame-like extras", async () => {
		const fm = createDemoFileManager()
		const root = await fm.folder_with_children_xattrs("/demo")
		const names = (root.children ?? []).map(child => child.name)
		expect(names).toEqual(expect.arrayContaining([
			"Welcome.txt",
			"Notes",
			"Ideas",
			"Mood.txt",
			"Harbor morning.svg",
			"References",
			"Live.txt",
		]))

		const references = await fm.folder_with_children_xattrs("/demo/References")
		expect((references.children ?? []).map(child => child.name)).toEqual(expect.arrayContaining([
			"Shot list.txt",
			"Color notes.txt",
			"Locations.txt",
			"Stills",
		]))

		const connections = await fm.connections.list_connections("/demo")
		expect(connections).toEqual([
			expect.objectContaining({
				from: "/demo/References",
				to: "/demo/Live.txt",
				marker_end: "arrow",
			}),
		])
	})

	test("createDemoFileManagerFrom keeps src files on the server and seeds per-folder sidecars", async () => {
		const real_fetch = globalThis.fetch
		const fetched: string[] = []
		globalThis.fetch = (async (input: string | URL | Request) => {
			fetched.push(String(input))
			return new Response("bytes")
		}) as typeof fetch
		try {
			const fm = createDemoFileManagerFrom({
				version: 1,
				root: "/demo",
				tree: [
					{ path: "", type: "folder", xattrs: { view: "board" } },
					{ path: "Canvas", type: "folder", xattrs: { view: "canvas" } },
					{ path: "Canvas/Note.md", type: "file", content: "# Hi" },
					{ path: "Canvas/Photo.jpg", type: "file", src: "/demo-pack/files/Canvas/Photo.jpg", size: 1234 },
				],
				folder_connections: {
					// the pack stores endpoints relative to their folder
					Canvas: [{
						id: "Note.md:right-Photo.jpg:left",
						from: "Note.md",
						to: "Photo.jpg",
						from_handle: "right",
						to_handle: "left",
						is_animated: false,
					}],
				},
				folder_strokes: {
					Canvas: [{ id: "s1", z: 0, position: { x: 0, y: 0 }, points: [{ x: 1, y: 1 }], color: "#000", stroke_width: 2, width: 2, height: 2 }],
				},
			})

			const canvas = await fm.folder_with_children_xattrs("/demo/Canvas")
			expect((canvas.children ?? []).map(child => child.name).sort()).toEqual(["Note.md", "Photo.jpg"])
			expect(await fm.read_text_file("/demo/Canvas/Note.md")).toBe("# Hi")

			// media renders from the URL, the size is known up front: nothing fetched yet
			expect((await fm.get_media_src("/demo/Canvas/Photo.jpg")).url).toBe("/demo-pack/files/Canvas/Photo.jpg")
			expect(await fm.entry_size("/demo/Canvas/Photo.jpg")).toBe(1234)
			expect(fetched).toEqual([])
			// bytes load on read
			expect(await fm.read_text_file("/demo/Canvas/Photo.jpg")).toBe("bytes")
			expect(fetched).toEqual(["/demo-pack/files/Canvas/Photo.jpg"])
			// a copy stays URL-backed, a save replaces the URL with text
			await fm.copy_file("/demo/Canvas/Photo.jpg", "/demo", "Copy.jpg")
			expect((await fm.get_media_src("/demo/Copy.jpg")).url).toBe("/demo-pack/files/Canvas/Photo.jpg")
			await fm.save_text_file("/demo/Copy.jpg", "text")
			expect(await fm.read_text_file("/demo/Copy.jpg")).toBe("text")
			expect(await fm.entry_size("/demo/Copy.jpg")).toBe(4)

			const connections = await fm.connections.list_connections("/demo/Canvas")
			expect(connections).toEqual([expect.objectContaining({
				id: "/demo/Canvas/Note.md:right-/demo/Canvas/Photo.jpg:left",
				from: "/demo/Canvas/Note.md",
				to: "/demo/Canvas/Photo.jpg",
			})])
			expect((await fm.strokes.list_strokes("/demo/Canvas")).map(s => s.id)).toEqual(["s1"])
		} finally {
			globalThis.fetch = real_fetch
		}
	})
})

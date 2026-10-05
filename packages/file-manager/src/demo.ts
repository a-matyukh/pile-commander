import { createFakeFileManager } from "./fake"
import { resolve_folder_connections } from "./connectionPaths"
import type { FileManager, FolderConnection, FolderStroke } from "./types"
import demoContentJson from "./demo-content.json"

export type DemoContentEntry = {
	path: string
	type: "file" | "folder"
	content?: string
	/** URL of a binary file's bytes: loaded on demand, never prefetched. */
	src?: string
	/** Byte size of a `src` file. */
	size?: number
	xattrs?: Record<string, string>
}

export type DemoContent = {
	version: number
	root: string
	tree: DemoContentEntry[]
	connections?: FolderConnection[]
	/**
	 * Per-folder sidecars, keyed by folder path relative to `root`. Connection
	 * endpoints may be relative to their folder (the demo pack's are).
	 */
	folder_connections?: Record<string, FolderConnection[]>
	folder_strokes?: Record<string, FolderStroke[]>
}

/**
 * The bundled demo: the pack's Welcome folder, and the fallback workspace
 * when the pack cannot be loaded.
 */
export const demoContent = demoContentJson as unknown as DemoContent

/** In-memory FileManager pre-seeded from the bundled demo-content.json. */
export function createDemoFileManager(): FileManager {
	return createDemoFileManagerFrom(demoContent)
}

/**
 * In-memory FileManager over any DemoContent — the demo pack exported from
 * piles/ (apps/client/scripts/export-demo-pack.ts). `src` files stay on the
 * server: media renders from the URL, bytes load only when read.
 */
export function createDemoFileManagerFrom(content: DemoContent): FileManager {
	const fake = createFakeFileManager()
	const { root, tree } = content
	const abs_of = (path: string) => path ? `${root}/${path}` : root

	for (const entry of tree) {
		const abs = abs_of(entry.path)

		if (entry.type === "folder") {
			fake.seed_folder(abs)
		} else if (entry.src) {
			fake.seed_url_file(abs, entry.src, entry.size ?? 0)
		} else {
			fake.seed_file(abs, entry.content ?? "")
		}

		for (const [name, value] of Object.entries(entry.xattrs ?? {})) {
			fake.set_xattr(abs, name, value)
		}
	}

	if (content.connections?.length) {
		fake.seed_connections(root, content.connections)
	}
	for (const [folder, connections] of Object.entries(content.folder_connections ?? {})) {
		const folder_id = abs_of(folder)
		fake.seed_connections(folder_id, resolve_folder_connections(connections, folder_id))
	}
	for (const [folder, strokes] of Object.entries(content.folder_strokes ?? {})) {
		fake.seed_strokes(abs_of(folder), strokes)
	}

	return fake.fm
}

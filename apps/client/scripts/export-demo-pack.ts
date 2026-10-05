/**
 * piles/ → the web demo pack and the landing's .pile downloads.
 *
 *   bun run demo:pack
 *
 * Writes:
 *   apps/client/public/demo-pack/manifest.json   DemoContent for /demo (and the desktop "Open demo")
 *   apps/client/public/demo-pack/files/…         binaries, photos recompressed
 *   apps/landing/public/demos/features.pile      Features as a .pile archive
 *   apps/landing/public/demos/use-cases.pile     Use cases as a .pile archive
 *
 * The demo root is a start page: a welcome note, Features and Use cases
 * (from piles/) with a caption each, and Sandbox below (the bundled
 * demo-content.json) — see ROOT_FOLDERS / ROOT_NOTES for the layout and copy. Re-run after editing piles/ (the demo-piles skill) or
 * demo-content.json — or use `bun run demo:publish`, which also commits.
 * macOS only: photos go through `sips`, layout through the skill's pile_attrs.py.
 *
 * The output is deterministic: an unchanged piles/ rebuilds byte-identical files.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"
import { makeZip } from "client-zip"
import {
	PILE_ATTRS_FILE,
	PILE_DIR_NAME,
	collectPileAttrs,
	createDemoFileManagerFrom,
	demoContent,
	resolve_connection_endpoint,
	serializePileAttrsManifest,
	type DemoContent,
	type DemoContentEntry,
	type FolderConnection,
	type FolderStroke,
} from "@pile-commander/file-manager"

const REPO = join(import.meta.dir, "../../..")
const PILES = join(REPO, "piles")
const PACK = join(REPO, "apps/client/public/demo-pack")
const FILES = join(PACK, "files")
const PILE_OUT = join(REPO, "apps/landing/public/demos")
/** URL the client fetches the pack files from (same origin as the app). */
const PACK_URL = "/demo-pack/files"
const ROOT = "/demo"

const TEXT = new Set(["md", "txt", "svg", "json", "csv"])
const PHOTO = new Set(["jpg", "jpeg"])
const HIDDEN = new Set([PILE_DIR_NAME, ".DS_Store"])
const PHOTO_MAX_PX = 1600
const PHOTO_QUALITY = 80

type Box = { x: number; y: number; width: number; height: number }

/**
 * The root board. It must read in the landing hero iframe (~700 × 460 px of
 * board): the welcome note and the two main folders above the fold, Sandbox
 * just below.
 */
const ROOT_FOLDERS: Record<string, Box & { order: number; cover?: string }> = {
	"Features": { x: 40, y: 180, width: 300, height: 150, order: 1, cover: "#BFDBFE" },
	"Use cases": { x: 360, y: 180, width: 300, height: 150, order: 2, cover: "#FDE68A" },
	"Sandbox": { x: 40, y: 450, width: 300, height: 110, order: 5 },
}
const ROOT_NOTES: (Box & { name: string; order: number; background?: string; text: string })[] = [
	{
		name: "Welcome.md", x: 40, y: 30, width: 620, height: 130, order: 0, background: "#E8F3FE",
		text: "# Welcome to Pile Commander 👋\n\n"
			+ "Every folder here is a board. **Double-click** to open one, **←** to go back. "
			+ "Drag, resize and edit anything: this demo runs in your browser and nothing is saved.\n",
	},
	{
		name: "About Features.md", x: 40, y: 340, width: 300, height: 80, order: 3,
		text: "A tour of every view, file type and canvas tool, one folder each.\n",
	},
	{
		name: "About Use cases.md", x: 360, y: 340, width: 300, height: 80, order: 4,
		text: "20 real boards: moodboards, trips, kanban, research, a wedding and more.\n",
	},
	{
		name: "About Sandbox.md", x: 360, y: 450, width: 300, height: 110, order: 6,
		text: "**Sandbox** is a scratch board to try things: double-click empty space for a note, drop in your own files.\n",
	},
]
/** Sandbox's first note: the bundled Welcome.txt greets a whole workspace, not a scratch folder. */
const SANDBOX_START = {
	from: "Welcome.txt",
	name: "Start here.txt",
	text: "Your scratch board.\n\nCreate notes and folders, drag things around, drop in files — nothing is written to disk.",
}
const PILE_ATTRS_TOOL = join(REPO, ".claude/skills/demo-piles/pile_attrs.py")
/** Fixed zip timestamps: a rebuild must not change the archives' bytes. */
const ZIP_DATE = new Date("2026-01-01T00:00:00Z")
const PILES_EXPORTED: [folder: string, file: string][] = [
	["Features", "features.pile"],
	["Use cases", "use-cases.pile"],
]

if (!existsSync(PILES)) throw new Error("piles/ is required (see .claude/skills/demo-piles)")
if (!existsSync(PILE_ATTRS_TOOL)) throw new Error(`${PILE_ATTRS_TOOL} is required to read the layout`)

// Layout edited in the app lives in xattrs; attrs.json only mirrors it after
// a save. Without this a stale layout would be published silently.
const save = Bun.spawnSync(["python3", PILE_ATTRS_TOOL, "save", PILES])
if (save.exitCode !== 0) throw new Error(`pile_attrs.py save: ${save.stderr.toString()}`)

const attrs: Record<string, Record<string, string>> =
	JSON.parse(readFileSync(join(PILES, PILE_DIR_NAME, "attrs.json"), "utf8")).attrs

rmSync(PACK, { recursive: true, force: true })
mkdirSync(FILES, { recursive: true })

const tree: DemoContentEntry[] = [{ path: "", type: "folder", xattrs: { view: "board" } }]
const folder_connections: Record<string, FolderConnection[]> = {}
const folder_strokes: Record<string, FolderStroke[]> = {}
/** pack path → file on disk with the bytes the pack serves */
const disk_bytes = new Map<string, string>()
/** content hash → pack path already serving those bytes (demos reuse media) */
const served = new Map<string, string>()

function box_xattrs({ x, y, width, height }: Box): Record<string, string> {
	return { position: JSON.stringify({ x, y }), size: JSON.stringify({ width, height }) }
}

function top_level_xattrs(name: string, own: Record<string, string> = {}): Record<string, string> {
	const slot = ROOT_FOLDERS[name]!
	return {
		...own,
		...box_xattrs(slot),
		order: String(slot.order),
		...(slot.cover ? { cover: slot.cover } : {}),
	}
}

/** Connection endpoints relative to their folder: no author paths leave this machine. */
function relative_connections(list: FolderConnection[], folder_rel: string): FolderConnection[] {
	const folder_id = folder_rel ? `${ROOT}/${folder_rel}` : ROOT
	const rel = (endpoint: string) => {
		const resolved = resolve_connection_endpoint(endpoint, folder_id)
		if (resolved === folder_id) return "."
		if (!resolved.startsWith(folder_id + "/")) {
			throw new Error(`${folder_rel}: connection endpoint ${endpoint} is outside the folder`)
		}
		return resolved.slice(folder_id.length + 1)
	}
	return list.map(connection => {
		const from = rel(connection.from)
		const to = rel(connection.to)
		// deterministic id over the relative endpoints: seeding remints it onto the demo root
		const id = `${from}:${connection.from_handle ?? "default"}-${to}:${connection.to_handle ?? "default"}`
		return { ...connection, id, from, to }
	})
}

function sidecar<T>(dir: string, name: string): T[] {
	const file = join(dir, PILE_DIR_NAME, name)
	return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) as T[] : []
}

/** Photos shrink to PHOTO_MAX_PX at PHOTO_QUALITY; the original wins when it is smaller. */
function export_binary(abs: string, rel: string): string {
	const out = join(FILES, rel)
	mkdirSync(dirname(out), { recursive: true })
	const ext = abs.split(".").pop()!.toLowerCase()
	if (PHOTO.has(ext)) {
		const tmp = join(tmpdir(), `demo-pack-${process.pid}.${ext}`)
		const run = Bun.spawnSync(["sips", "-Z", String(PHOTO_MAX_PX), "-s", "formatOptions", String(PHOTO_QUALITY), abs, "--out", tmp])
		if (run.exitCode !== 0) throw new Error(`sips ${rel}: ${run.stderr.toString()}`)
		copyFileSync(statSync(tmp).size < statSync(abs).size ? tmp : abs, out)
		rmSync(tmp, { force: true })
	} else {
		copyFileSync(abs, out)
	}
	return out
}

function walk(dir: string) {
	const rel_dir = relative(PILES, dir)
	const connections = sidecar<FolderConnection>(dir, "connections.json")
	if (connections.length) folder_connections[rel_dir] = relative_connections(connections, rel_dir)
	const strokes = sidecar<FolderStroke>(dir, "strokes.json")
	if (strokes.length) folder_strokes[rel_dir] = strokes

	for (const name of readdirSync(dir).sort()) {
		if (HIDDEN.has(name)) continue
		const abs = join(dir, name)
		const rel = relative(PILES, abs)
		const is_top = !rel_dir
		if (is_top && (!ROOT_FOLDERS[name] || name === "Sandbox")) {
			console.warn(`skipping piles/${name}: not a demo section`)
			continue
		}
		const own = attrs[rel]
		const xattrs = is_top ? top_level_xattrs(name, own) : own
		if (statSync(abs).isDirectory()) {
			tree.push({ path: rel, type: "folder", ...(xattrs ? { xattrs } : {}) })
			walk(abs)
			continue
		}
		const ext = name.split(".").pop()!.toLowerCase()
		if (TEXT.has(ext)) {
			tree.push({ path: rel, type: "file", content: readFileSync(abs, "utf8"), ...(xattrs ? { xattrs } : {}) })
			continue
		}
		const hash = Bun.hash(readFileSync(abs)).toString(16)
		const same = served.get(hash)
		const out = same ? disk_bytes.get(same)! : export_binary(abs, rel)
		if (!same) served.set(hash, rel)
		disk_bytes.set(rel, out)
		tree.push({
			path: rel,
			type: "file",
			src: `${PACK_URL}/${(same ?? rel).split("/").map(encodeURIComponent).join("/")}`,
			size: statSync(out).size,
			...(xattrs ? { xattrs } : {}),
		})
	}
}

// the start page's notes
for (const note of ROOT_NOTES) {
	tree.push({
		path: note.name,
		type: "file",
		content: note.text,
		xattrs: {
			is_preview: "true",
			...box_xattrs(note),
			order: String(note.order),
			...(note.background ? { background: note.background } : {}),
		},
	})
}

// Sandbox: the bundled demo, moved one level down
for (const entry of demoContent.tree) {
	if (entry.path === "") {
		tree.push({ path: "Sandbox", type: "folder", xattrs: top_level_xattrs("Sandbox", entry.xattrs) })
	} else if (entry.path === SANDBOX_START.from) {
		tree.push({ ...entry, path: `Sandbox/${SANDBOX_START.name}`, content: SANDBOX_START.text })
	} else {
		tree.push({ ...entry, path: `Sandbox/${entry.path}` })
	}
}
if (demoContent.connections?.length) {
	folder_connections["Sandbox"] = relative_connections(
		demoContent.connections.map(connection => ({
			...connection,
			from: connection.from.replace(`${demoContent.root}/`, ""),
			to: connection.to.replace(`${demoContent.root}/`, ""),
		})),
		"Sandbox",
	)
}
walk(PILES)

const pack: DemoContent = { version: 1, root: ROOT, tree, folder_connections, folder_strokes }
const json = JSON.stringify(pack)
// nothing from the author's disk may be published
const leak = json.match(/\/Users\/[^"\\]*|\/home\/[^"\\]*|[A-Za-z]:\\\\[^"]*/)
if (leak) throw new Error(`the pack would publish a local path: ${leak[0]}`)
writeFileSync(join(PACK, "manifest.json"), json)

// .pile archives: layout collected from the same in-memory demo the app shows
mkdirSync(PILE_OUT, { recursive: true })
const fm = createDemoFileManagerFrom(pack)
for (const [folder, file] of PILES_EXPORTED) {
	const manifest = await collectPileAttrs(fm, `${ROOT}/${folder}`)
	type ZipEntry = { name: string; lastModified: Date; input?: string | Uint8Array }
	const entries: ZipEntry[] = [{ name: `${folder}/`, lastModified: ZIP_DATE }]
	for (const entry of tree) {
		if (!entry.path.startsWith(`${folder}/`)) continue
		if (entry.type === "folder") {
			entries.push({ name: `${entry.path}/`, lastModified: ZIP_DATE })
		} else {
			const bytes = disk_bytes.get(entry.path)
			entries.push({ name: entry.path, lastModified: ZIP_DATE, input: bytes ? readFileSync(bytes) : entry.content ?? "" })
		}
	}
	// the desktop import reads the layout from here; it goes last, like the app's own export
	entries.push({ name: `${folder}/${PILE_DIR_NAME}/${PILE_ATTRS_FILE}`, lastModified: ZIP_DATE, input: serializePileAttrsManifest(manifest) })
	const zip = new Uint8Array(await new Response(makeZip(entries)).arrayBuffer())
	writeFileSync(join(PILE_OUT, file), zip)
	console.log(`${file}: ${(zip.byteLength / 1e6).toFixed(1)} MB`)
}

const pack_bytes = [...new Set(disk_bytes.values())].reduce((sum, file) => sum + statSync(file).size, json.length)
console.log(`demo pack: ${tree.length} entries, ${served.size} binaries, ${(pack_bytes / 1e6).toFixed(1)} MB`)

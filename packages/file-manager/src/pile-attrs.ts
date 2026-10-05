import type { ConnectionHandle, ConnectionMarker, FileManager, FolderConnection, FolderStroke, Xattr } from "./types"

export const PILE_ATTRS_VERSION = 1
export const PILE_DIR_NAME = ".pile"
export const PILE_ATTRS_FILE = "attrs.json"
/** Manifest key carrying a folder's ink — same key the legacy xattr used. */
export const STROKES_ATTR = "strokes"
/** Manifest key carrying a folder's edges — same key the legacy xattr used. */
export const CANVAS_ATTR = "canvas"

const CONNECTION_HANDLES = new Set<string>(["top", "right", "bottom", "left"])
const CONNECTION_MARKERS = new Set<string>(["arrow", "arrowclosed"])

function is_position(value: unknown): value is { x: number; y: number } {
	if (!value || typeof value !== "object") return false
	const p = value as Record<string, unknown>
	return typeof p.x === "number" && typeof p.y === "number"
}

/**
 * Tolerant parse of a packed strokes manifest value. Accepts both the
 * current FolderStroke rows and the legacy xattr payload (which had a
 * `type` tag and no `z` — the array index becomes `z`).
 */
export function parse_packed_strokes(value: string): FolderStroke[] {
	let raw: unknown
	try {
		raw = JSON.parse(value)
	} catch {
		return []
	}
	if (!Array.isArray(raw)) return []
	const strokes: FolderStroke[] = []
	for (const [index, item] of raw.entries()) {
		if (!item || typeof item !== "object") continue
		const s = item as Record<string, unknown>
		if (typeof s.id !== "string") continue
		if (!is_position(s.position) || !Array.isArray(s.points) || !s.points.every(is_position)) continue
		if (typeof s.color !== "string" || typeof s.stroke_width !== "number") continue
		if (typeof s.width !== "number" || typeof s.height !== "number") continue
		strokes.push({
			id: s.id,
			z: typeof s.z === "number" ? s.z : index,
			position: s.position,
			points: s.points,
			color: s.color,
			stroke_width: s.stroke_width,
			width: s.width,
			height: s.height,
		})
	}
	return strokes
}

/**
 * Tolerant parse of a packed connections manifest value. Accepts both the
 * legacy xattr payload (`{ connections: [...] }`) and a bare array.
 */
export function parse_packed_connections(value: string): FolderConnection[] {
	let raw: unknown
	try {
		raw = JSON.parse(value)
	} catch {
		return []
	}
	const list: unknown[] = Array.isArray(raw)
		? raw
		: raw && typeof raw === "object" && Array.isArray((raw as Record<string, unknown>).connections)
			? ((raw as Record<string, unknown>).connections as unknown[])
			: []
	const connections: FolderConnection[] = []
	for (const item of list) {
		if (!item || typeof item !== "object") continue
		const c = item as Record<string, unknown>
		if (typeof c.id !== "string" || typeof c.from !== "string" || typeof c.to !== "string") continue
		const label = typeof c.label === "string" && c.label !== "" ? c.label : undefined
		connections.push({
			id: c.id,
			from: c.from,
			to: c.to,
			from_handle: typeof c.from_handle === "string" && CONNECTION_HANDLES.has(c.from_handle)
				? (c.from_handle as ConnectionHandle)
				: undefined,
			to_handle: typeof c.to_handle === "string" && CONNECTION_HANDLES.has(c.to_handle)
				? (c.to_handle as ConnectionHandle)
				: undefined,
			marker_start: typeof c.marker_start === "string" && CONNECTION_MARKERS.has(c.marker_start)
				? (c.marker_start as ConnectionMarker)
				: undefined,
			marker_end: typeof c.marker_end === "string" && CONNECTION_MARKERS.has(c.marker_end)
				? (c.marker_end as ConnectionMarker)
				: undefined,
			is_animated: c.is_animated === true,
			...(label ? { label } : {}),
		})
	}
	return connections
}

/** Deterministic connection id (embeds the endpoints) — mirrors the client's make_connection_id. */
function connection_id(
	from: string,
	to: string,
	from_handle?: ConnectionHandle,
	to_handle?: ConnectionHandle,
): string {
	return `${from}:${from_handle ?? "default"}-${to}:${to_handle ?? "default"}`
}

function remap_connection_endpoints(
	connection: FolderConnection,
	map: (endpoint: string) => string,
): FolderConnection {
	const from = map(connection.from)
	const to = map(connection.to)
	// uuid-fallback ids stay; deterministic ids are recomputed from the new endpoints
	const id = connection.id === connection_id(connection.from, connection.to, connection.from_handle, connection.to_handle)
		? connection_id(from, to, connection.from_handle, connection.to_handle)
		: connection.id
	return { ...connection, id, from, to }
}

export type PileAttrsManifest = {
	version: number
	attrs: Record<string, Record<string, string>>
}

export type ApplyPileAttrsResult = {
	missing: string[]
}

export type ApplyPileAttrsOptions = {
	/**
	 * Re-mint stroke ids. Cloud stroke ids are a table-wide primary key: ids
	 * that already live in another cloud workspace (a second copy of the same
	 * workspace, a pack exported from the cloud) would move those rows instead
	 * of inserting new ones. A folder that already holds ink is skipped, so a
	 * retried apply does not duplicate it.
	 */
	fresh_stroke_ids?: boolean
}

const PILE_DIR = PILE_DIR_NAME

function path_separator(path: string): string {
	return path.includes("\\") ? "\\" : "/"
}

function join_path(root: string, relative: string): string {
	if (!relative) return root
	const sep = path_separator(root)
	// a root that already ends with the separator (the cloud root "/", a
	// drive root) must not double it: "/" + "a" is "/a", not "//a"
	const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root
	return `${base}${sep}${relative.split("/").join(sep)}`
}

function relative_path(root: string, absolute: string): string {
	if (absolute === root) return ""
	const sep = path_separator(root)
	const prefix = root.endsWith(sep) ? root : root + sep
	if (!absolute.startsWith(prefix)) {
		throw new Error(`path ${absolute} is not under root ${root}`)
	}
	return absolute.slice(prefix.length).split(/[/\\]/).join("/")
}

function is_absolute_path(path: string): boolean {
	return path.startsWith("/") || path.startsWith("\\") || /^[A-Za-z]:[/\\]/.test(path)
}

function xattrs_to_record(xattrs: Xattr[]): Record<string, string> {
	const out: Record<string, string> = {}
	for (const { name, value } of xattrs) {
		out[name] = value
	}
	return out
}

export function parsePileAttrsManifest(input: unknown): PileAttrsManifest {
	if (!input || typeof input !== "object") {
		throw new Error("pile attrs: manifest must be an object")
	}
	const raw = input as Record<string, unknown>
	if (typeof raw.version !== "number" || !Number.isFinite(raw.version)) {
		throw new Error("pile attrs: version is required")
	}
	if (!raw.attrs || typeof raw.attrs !== "object" || Array.isArray(raw.attrs)) {
		throw new Error("pile attrs: attrs must be an object")
	}

	const attrs: Record<string, Record<string, string>> = {}
	for (const [path, value] of Object.entries(raw.attrs as Record<string, unknown>)) {
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`pile attrs: attrs[${JSON.stringify(path)}] must be an object`)
		}
		const entry: Record<string, string> = {}
		for (const [name, attr_value] of Object.entries(value as Record<string, unknown>)) {
			if (typeof attr_value !== "string") {
				throw new Error(
					`pile attrs: attrs[${JSON.stringify(path)}][${JSON.stringify(name)}] must be a string`,
				)
			}
			entry[name] = attr_value
		}
		attrs[path] = entry
	}

	return { version: raw.version, attrs }
}

export function serializePileAttrsManifest(manifest: PileAttrsManifest): string {
	return JSON.stringify(manifest, null, "\t")
}

/**
 * Walk the workspace tree and collect xattrs keyed by relative path. One
 * folder_with_children_xattrs per folder (a single round-trip on the cloud
 * backend) instead of an xattr read per entry. `.pile` sidecar folders are
 * skipped at any depth.
 */
export async function collectPileAttrs(
	fm: FileManager,
	rootId: string,
): Promise<PileAttrsManifest> {
	const attrs: Record<string, Record<string, string>> = {}

	async function visit(absolute: string) {
		const relative = relative_path(rootId, absolute)
		const folder = await fm.folder_with_children_xattrs(absolute)
		// a folder's own xattrs arrive with its parent's listing; only the
		// root has no parent listing
		if (relative === "" && folder.xattrs.length > 0) {
			attrs[relative] = xattrs_to_record(folder.xattrs)
		}

		// Folder ink rides along under the legacy `strokes` key, so packs stay
		// compatible with builds that still read the xattr payload.
		const strokes = await fm.strokes.list_strokes(absolute)
		if (strokes.length > 0) {
			attrs[relative] = { ...(attrs[relative] ?? {}), [STROKES_ATTR]: JSON.stringify(strokes) }
		}

		// Edges ride along under the legacy `canvas` key. Endpoints are packed
		// root-relative: the import destination root differs from the source's,
		// and relative paths rebase onto it cleanly (legacy packs carried
		// absolute paths and their edges silently died on import).
		const connections = await fm.connections.list_connections(absolute)
		if (connections.length > 0) {
			const packed = connections.map(connection =>
				remap_connection_endpoints(connection, endpoint => relative_path(rootId, endpoint)),
			)
			attrs[relative] = {
				...(attrs[relative] ?? {}),
				[CANVAS_ATTR]: JSON.stringify({ connections: packed }),
			}
		}

		for (const child of folder.children) {
			if (child.name === PILE_DIR) continue
			if (child.xattrs.length > 0) {
				attrs[relative_path(rootId, child.id)] = xattrs_to_record(child.xattrs)
			}
			if (child.type === "folder") {
				await visit(child.id)
			}
		}
	}

	await visit(rootId)
	return { version: PILE_ATTRS_VERSION, attrs }
}

/**
 * Apply sidecar xattrs onto an extracted workspace tree: plain attributes in
 * one set_xattrs batch, ink and edges per folder.
 * Missing paths are collected in `missing` (not thrown).
 */
export async function applyPileAttrs(
	fm: FileManager,
	rootId: string,
	manifest: PileAttrsManifest,
	options: ApplyPileAttrsOptions = {},
): Promise<ApplyPileAttrsResult> {
	const missing = new Set<string>()
	const relative_by_id = new Map<string, string>()
	const patches: { id: string; xattrs: Record<string, string> }[] = []

	for (const [relative, entry_attrs] of Object.entries(manifest.attrs)) {
		const plain: Record<string, string> = {}
		for (const [name, value] of Object.entries(entry_attrs)) {
			if (name !== STROKES_ATTR && name !== CANVAS_ATTR) plain[name] = value
		}
		if (Object.keys(plain).length === 0) continue
		const absolute = join_path(rootId, relative)
		relative_by_id.set(absolute, relative)
		patches.push({ id: absolute, xattrs: plain })
	}

	if (patches.length > 0) {
		try {
			const result = await fm.set_xattrs(patches)
			for (const id of result.missing) missing.add(relative_by_id.get(id) ?? id)
		} catch {
			for (const relative of relative_by_id.values()) missing.add(relative)
		}
	}

	for (const [relative, entry_attrs] of Object.entries(manifest.attrs)) {
		const absolute = join_path(rootId, relative)
		try {
			const packed_strokes = entry_attrs[STROKES_ATTR]
			if (packed_strokes !== undefined) {
				// Ink is entity storage now, not an xattr.
				await apply_strokes(fm, absolute, parse_packed_strokes(packed_strokes), options)
			}
			const packed_connections = entry_attrs[CANVAS_ATTR]
			if (packed_connections !== undefined) {
				// Edges are entity storage now, not an xattr. Root-relative
				// endpoints (new packs) rebase onto the destination root;
				// absolute ones (legacy packs) pass through verbatim — the
				// render-time filter drops the ones that point nowhere.
				const connections = parse_packed_connections(packed_connections).map(connection =>
					remap_connection_endpoints(connection, endpoint =>
						is_absolute_path(endpoint) ? endpoint : join_path(rootId, endpoint)),
				)
				if (connections.length > 0) {
					await fm.connections.upsert_connections(absolute, connections)
				}
			}
		} catch {
			missing.add(relative)
		}
	}

	return { missing: [...missing] }
}

async function apply_strokes(
	fm: FileManager,
	folder_id: string,
	strokes: FolderStroke[],
	options: ApplyPileAttrsOptions,
): Promise<void> {
	if (strokes.length === 0) return
	if (!options.fresh_stroke_ids) {
		await fm.strokes.upsert_strokes(folder_id, strokes)
		return
	}
	if ((await fm.strokes.list_strokes(folder_id)).length > 0) return
	await fm.strokes.upsert_strokes(
		folder_id,
		strokes.map(stroke => ({ ...stroke, id: crypto.randomUUID() })),
	)
}

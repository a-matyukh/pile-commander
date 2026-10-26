import type { FileManager, FolderConnection, FolderStroke } from '@pile-commander/file-manager'
import { PILE_DIR_NAME } from '@pile-commander/file-manager'
import { is_hidden_entry_name, is_os_junk_name } from '@/services/workspace/hiddenName'
import { is_cloud_name } from '@/services/cloud/bridge/preflight'
import { run_pool } from '@/services/cloud/bridge/pool'
import { hash_value } from './hash'
import { is_hidden_relative, join_local, join_relative, parent_relative, relative_of } from './paths'
import type { LocalEntry } from './types'

/** Size and content mtime of a local file. */
export type LocalStat = (id: string) => Promise<{ size: number; mtime_ms: number }>

/** Visible folders that contain a hidden name at any depth. The hidden folder itself is not included. */
function note_hidden_inside(folders: Set<string>, parent: string): void {
	let at = parent
	for (;;) {
		folders.add(at)
		if (at === '') break
		at = parent_relative(at)
	}
}

/** Local stats read at once: a stat is one IPC call each. */
const STAT_CONCURRENCY = 8

export type LocalScan = {
	entries: LocalEntry[]
	/** Visible folders with a hidden name somewhere inside. */
	folders_with_hidden: ReadonlySet<string>
}

/**
 * Walks the synced folder breadth-first (parents before children), skipping
 * `.pile` sidecars, hidden names and OS litter. A file that vanishes mid-walk
 * is left out. A hidden folder is not entered.
 */
export async function scan_local(fm: FileManager, root: string, stat: LocalStat): Promise<LocalScan> {
	const entries: LocalEntry[] = []
	const folders_with_hidden = new Set<string>()
	const queue: { id: string; relative: string; bad_name: boolean }[] = [{ id: root, relative: '', bad_name: false }]
	for (let index = 0; index < queue.length; index++) {
		const folder = queue[index]!
		for (const child of await fm.FolderChildren(folder.id)) {
			// Junk first: .DS_Store is skipped and does not protect the folder.
			if (child.name === PILE_DIR_NAME || is_os_junk_name(child.name)) continue
			if (is_hidden_entry_name(child.name)) {
				note_hidden_inside(folders_with_hidden, folder.relative)
				continue
			}
			const relative = join_relative(folder.relative, child.name)
			const bad_name = folder.bad_name || !is_cloud_name(child.name)
			entries.push({ relative, id: child.id, name: child.name, kind: child.type, size: 0, mtime_ms: 0, bad_name })
			if (child.type === 'folder') queue.push({ id: child.id, relative, bad_name })
		}
	}
	const vanished = new Set<string>()
	await run_pool(entries.filter(entry => entry.kind === 'file'), STAT_CONCURRENCY, async (entry) => {
		try {
			const info = await stat(entry.id)
			entry.size = info.size
			entry.mtime_ms = info.mtime_ms
		} catch {
			vanished.add(entry.relative)
		}
	})
	const live = vanished.size > 0 ? entries.filter(entry => !vanished.has(entry.relative)) : entries
	return { entries: live, folders_with_hidden }
}

/** Ink and edges of one folder, edges with root-relative endpoints. */
export type LocalFolderLayout = {
	strokes: FolderStroke[]
	connections: FolderConnection[]
	/** The v1 hashes of this ink and these edges, to tell whether a v1 state saw them. */
	legacy: { strokes_hash: string; connections_hash: string }
}

/** The layout of the synced folder, keyed by relative path. */
export type LocalLayout = {
	/** Plain xattrs of every entry that has any (the root under ''). */
	xattrs: Map<string, Record<string, string>>
	folders: Map<string, LocalFolderLayout>
}

function edge_relative(root: string, connection: FolderConnection): FolderConnection | null {
	const from = relative_of(root, connection.from)
	const to = relative_of(root, connection.to)
	return from === null || to === null ? null : { ...connection, from, to }
}

/**
 * Reads xattrs, ink and edges of the given folders (relative paths, the
 * root included): one xattrs call per folder plus its two sidecars.
 */
export async function read_local_layout(
	fm: FileManager,
	root: string,
	folders: readonly string[],
): Promise<LocalLayout> {
	const layout: LocalLayout = { xattrs: new Map(), folders: new Map() }
	await run_pool(folders, STAT_CONCURRENCY, async (relative) => {
		const id = join_local(root, relative)
		const [listing, strokes, connections] = await Promise.all([
			fm.folder_with_children_xattrs(id),
			fm.strokes.list_strokes(id),
			fm.connections.list_connections(id),
		])
		if (relative === '' && listing.xattrs.length > 0) {
			layout.xattrs.set('', Object.fromEntries(listing.xattrs.map(({ name, value }) => [name, value])))
		}
		for (const child of listing.children) {
			if (child.name === PILE_DIR_NAME || is_hidden_entry_name(child.name) || child.xattrs.length === 0) continue
			layout.xattrs.set(
				join_relative(relative, child.name),
				Object.fromEntries(child.xattrs.map(({ name, value }) => [name, value])),
			)
		}
		const sorted_strokes = [...strokes].sort((a, b) => a.id.localeCompare(b.id))
		const edges = connections
			.map(connection => edge_relative(root, connection))
			.filter((connection): connection is FolderConnection => connection !== null)
			.filter(connection => !is_hidden_relative(connection.from) && !is_hidden_relative(connection.to))
			.sort((a, b) => a.id.localeCompare(b.id))
		layout.folders.set(relative, {
			strokes: sorted_strokes,
			connections: edges,
			legacy: {
				strokes_hash: hash_value(sorted_strokes),
				connections_hash: hash_value(edges.map(edge => ({ ...edge, id: '' }))),
			},
		})
	})
	return layout
}

import { PILE_DIR_NAME } from '@pile-commander/file-manager'
import { join_local } from './paths'

export type FoundDirEntry = { name: string; isDirectory: boolean; isSymlink?: boolean }

export type FindMovedDeps = {
	list(folder: string): Promise<FoundDirEntry[]>
	/** The folder's link file, or null */
	read_link_file(folder: string): Promise<string | null>
	/** The link file is the missing link's, now at `folder` */
	matches(folder: string, text: string): boolean
}

/** Folders looked at, at most: a pile of a whole disk must not stall the app */
export const FIND_MOVED_LIMIT = 5000

/**
 * A synced folder moved in Finder into another synced folder while the app
 * was closed: the folder (below `roots`) whose link file is the missing
 * link's. Breadth first, skipping hidden folders and symlinks; a folder with
 * `.pile` is the only one whose link file is read. Null when none is found
 */
export async function find_moved_folder_in(
	roots: string[],
	deps: FindMovedDeps,
	limit = FIND_MOVED_LIMIT,
): Promise<string | null> {
	const queue = [...roots]
	let looked = 0
	while (queue.length && looked < limit) {
		const folder = queue.shift()!
		looked++
		let entries: FoundDirEntry[]
		try {
			entries = await deps.list(folder)
		} catch {
			continue
		}
		if (!roots.includes(folder) && entries.some(entry => entry.name === PILE_DIR_NAME && entry.isDirectory)) {
			const text = await deps.read_link_file(folder).catch(() => null)
			if (text && deps.matches(folder, text)) return folder
		}
		for (const entry of entries) {
			if (!entry.isDirectory || entry.isSymlink || entry.name.startsWith('.')) continue
			queue.push(join_local(folder, entry.name))
		}
	}
	return null
}

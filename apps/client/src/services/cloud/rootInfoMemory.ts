import type { WorkspaceRootInfo } from '@pile-commander/file-manager'

/**
 * The last view and subfolders the cloud reported for each top-level folder,
 * per account, kept on this device. A closed top-level folder takes its icon
 * and chevron from them: a list read that fails (the network blinked, a token
 * was being refreshed) or misses a folder must not turn it into a plain
 * folder without a chevron until the next read. The next answer replaces them
 */

const KEY = 'pile_cloud_root_info'

type Kept = { owner: string; info: Record<string, WorkspaceRootInfo> }

let memory: Kept | null = null

function load(owner: string): Record<string, WorkspaceRootInfo> {
	if (memory?.owner === owner) return memory.info
	let kept: Kept | null = null
	try {
		const raw = localStorage.getItem(KEY)
		kept = raw ? (JSON.parse(raw) as Kept) : null
	} catch {
		// no storage or a broken value: nothing kept
	}
	// Another account's folders are never shown
	memory = { owner, info: kept?.owner === owner && kept.info && typeof kept.info === 'object' ? kept.info : {} }
	return memory.info
}

function save(next: Kept) {
	memory = next
	try {
		localStorage.setItem(KEY, JSON.stringify(next))
	} catch {
		// no storage: memory only
	}
}

/**
 * What the tree shows for these roots. `fresh` is the cloud's answer, or
 * null when the read failed. A successful answer is kept for next time; a
 * root it does not cover, or every root after a failure, takes what was
 * kept. Roots no longer in the list are forgotten
 */
export function root_info_with_kept(
	owner: string | null | undefined,
	root_ids: readonly string[],
	fresh: Record<string, WorkspaceRootInfo> | null,
): Record<string, WorkspaceRootInfo> {
	if (!owner) return fresh ?? {}
	const kept = load(owner)
	const shown: Record<string, WorkspaceRootInfo> = {}
	for (const id of root_ids) {
		const info = fresh?.[id] ?? kept[id]
		if (info) shown[id] = info
	}
	if (fresh) save({ owner, info: shown })
	return shown
}

/** Tests: forget the in-memory copy (the device copy stays) */
export function reset_root_info_memory() {
	memory = null
}

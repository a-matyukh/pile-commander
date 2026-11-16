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

const ROOTS_KEY = 'pile_cloud_roots'

/** A top-level cloud folder as the cloud page last listed it */
export type KeptCloudRoot = { id: string; name: string; can_write: boolean }

type KeptRoots = { owner: string; roots: KeptCloudRoot[] }

let roots_memory: KeptRoots | null = null

/**
 * The cloud's top-level folders as last listed for this account, or null
 * when none were kept. The cloud page shows them at once after a restart,
 * while the cloud is read again behind them
 */
export function kept_cloud_roots(owner: string): KeptCloudRoot[] | null {
	if (roots_memory?.owner !== owner) {
		let kept: KeptRoots | null = null
		try {
			const raw = localStorage.getItem(ROOTS_KEY)
			kept = raw ? (JSON.parse(raw) as KeptRoots) : null
		} catch {
			// no storage or a broken value: nothing kept
		}
		if (kept?.owner !== owner || !Array.isArray(kept.roots)) return null
		roots_memory = kept
	}
	return roots_memory.roots
}

/** Keeps the list the cloud just gave */
export function keep_cloud_roots(owner: string, roots: readonly KeptCloudRoot[]) {
	roots_memory = { owner, roots: roots.map(({ id, name, can_write }) => ({ id, name, can_write })) }
	try {
		localStorage.setItem(ROOTS_KEY, JSON.stringify(roots_memory))
	} catch {
		// no storage: memory only
	}
}

/** Sign-out: the next account must not see these folders' names or looks */
export function forget_cloud_roots() {
	roots_memory = null
	memory = null
	try {
		localStorage.removeItem(ROOTS_KEY)
		localStorage.removeItem(KEY)
	} catch {
		// no storage
	}
}

import { PILE_DIR_NAME } from '@pile-commander/file-manager'
import { join_local, relative_of } from './paths'
import { SYNC_STATE_VERSION, type SyncState } from './types'

export const SYNC_STATE_FILE = 'sync.json'

/** `<root>/.pile` */
export function sync_state_dir(root: string): string {
	return join_local(root, PILE_DIR_NAME)
}

/** `<root>/.pile/sync.json` */
export function sync_state_path(root: string): string {
	return join_local(root, `${PILE_DIR_NAME}/${SYNC_STATE_FILE}`)
}

/**
 * True for the state file, its temporary twin and the sync's own download
 * scratch files: writing them must not wake the watcher
 */
export function is_sync_state_path(path: string): boolean {
	return /[/\\]\.pile[/\\](sync\.json(\.tmp)?|sync-[^/\\]+\.tmp)$/.test(path)
}

export type SyncLinkOwner = {
	root_path: string
	device_id: string
	user_id: string
	workspace_id: string
}

/**
 * The state from the file, or null when it does not belong to this link: a
 * folder copied elsewhere or to another device carries the file along, and
 * must not push into the original's cloud workspace
 */
export function parse_sync_state(text: string, owner: SyncLinkOwner): SyncState | null {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		return null
	}
	if (!raw || typeof raw !== 'object') return null
	const state = raw as Partial<SyncState>
	// v1 is read as is: its first pass lifts it to v2 (seeds the layout base)
	if (state.version !== 1 && state.version !== SYNC_STATE_VERSION) return null
	if (state.root_path !== owner.root_path || state.device_id !== owner.device_id) return null
	if (state.user_id !== owner.user_id || state.workspace_id !== owner.workspace_id) return null
	if (!state.entries || typeof state.entries !== 'object' || !state.layout || typeof state.layout !== 'object') return null
	return {
		...(state as SyncState),
		exclude: Array.isArray(state.exclude) ? state.exclude.filter(item => typeof item === 'string') : [],
	}
}

/**
 * The folder's link file was written by another copy of the app (another
 * device id: another build, or this app before its data was reset) for this
 * account and this very folder. Null for a file of another account or of a
 * folder copied from elsewhere: that one must never be taken over.
 */
export function other_copy_link(
	text: string,
	here: { root_path: string; user_id: string; device_id: string },
): { workspace_id: string; device_id: string } | null {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		return null
	}
	if (!raw || typeof raw !== 'object') return null
	const file = raw as Partial<SyncState>
	if (typeof file.workspace_id !== 'string' || typeof file.device_id !== 'string') return null
	if (file.device_id === here.device_id) return null
	const state = parse_sync_state(text, {
		root_path: here.root_path,
		user_id: here.user_id,
		device_id: file.device_id,
		workspace_id: file.workspace_id,
	})
	return state ? { workspace_id: state.workspace_id, device_id: state.device_id } : null
}

/**
 * "Continue syncing here": the same state (its base snapshot keeps deletes
 * and conflicts right), now owned by this copy of the app. The other copy
 * no longer matches the file and pauses as unlinked
 */
export function take_over_state(text: string, owner: SyncLinkOwner, from_device: string): SyncState | null {
	const state = parse_sync_state(text, { ...owner, device_id: from_device })
	return state ? { ...state, device_id: owner.device_id } : null
}

/**
 * Where a linked folder is after a folder moved from `from` to `to`: the
 * folder itself, or one inside it (its parent moved). Null when the move
 * did not touch it
 */
export function moved_root(root: string, from: string, to: string): string | null {
	const relative = relative_of(from, root)
	if (relative === null) return null
	return join_local(to, relative)
}

/**
 * The link file of a folder the app moved: the same state (its base snapshot
 * keeps deletes and conflicts right), now at the new path. Null when the
 * file is not this link's
 */
export function moved_state(text: string, owner: SyncLinkOwner, root: string): SyncState | null {
	const state = parse_sync_state(text, owner)
	return state ? { ...state, root_path: root } : null
}

/**
 * The link file of a folder this copy of the app syncs at another path, for
 * this account: the folder was moved outside the app (Finder), or it is a
 * copy of it. The caller tells the two apart by whether the old path is
 * still there. Null for anything else
 */
export function moved_away_link(
	text: string,
	here: { root_path: string; user_id: string; device_id: string },
): { workspace_id: string; root_path: string } | null {
	let raw: unknown
	try {
		raw = JSON.parse(text)
	} catch {
		return null
	}
	if (!raw || typeof raw !== 'object') return null
	const file = raw as Partial<SyncState>
	if (typeof file.workspace_id !== 'string' || typeof file.root_path !== 'string') return null
	if (file.root_path === here.root_path) return null
	const state = parse_sync_state(text, { ...here, root_path: file.root_path, workspace_id: file.workspace_id })
	return state ? { workspace_id: state.workspace_id, root_path: state.root_path } : null
}

export function new_sync_state(owner: SyncLinkOwner, options: { exclude?: string[]; adopt_before?: number } = {}): SyncState {
	return {
		version: SYNC_STATE_VERSION,
		workspace_id: owner.workspace_id,
		user_id: owner.user_id,
		device_id: owner.device_id,
		root_path: owner.root_path,
		exclude: options.exclude ?? [],
		...(options.adopt_before === undefined ? {} : { adopt_before: options.adopt_before }),
		entries: {},
		layout: {},
	}
}

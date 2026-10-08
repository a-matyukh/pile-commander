import { PILE_DIR_NAME } from '@pile-commander/file-manager'
import { join_local } from './paths'
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

/** True for the state file and its temporary twin: writing them must not wake the watcher. */
export function is_sync_state_path(path: string): boolean {
	return /[/\\]\.pile[/\\]sync\.json(\.tmp)?$/.test(path)
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
	if (state.version !== SYNC_STATE_VERSION) return null
	if (state.root_path !== owner.root_path || state.device_id !== owner.device_id) return null
	if (state.user_id !== owner.user_id || state.workspace_id !== owner.workspace_id) return null
	if (!state.entries || typeof state.entries !== 'object' || !state.layout || typeof state.layout !== 'object') return null
	return {
		...(state as SyncState),
		exclude: Array.isArray(state.exclude) ? state.exclude.filter(item => typeof item === 'string') : [],
	}
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

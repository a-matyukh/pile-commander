import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { SYNC_KEPT_HIDDEN } from './layoutSync'
import { base_name } from './paths'

/**
 * "this Mac" on macOS, "this computer" on Windows and Linux. The app does
 * not ask the OS for a platform name; the webview user agent is enough,
 * and a phone-shaped agent that only mentions Mac OS X stays "this computer".
 */
export function sync_place(user_agent = typeof navigator === 'undefined' ? '' : navigator.userAgent): 'this Mac' | 'this computer' {
	const mac = /Macintosh|Mac OS X/i.test(user_agent)
	const other = /Windows|Android|iPhone|iPad|iPod|CrOS|Linux/i.test(user_agent)
	if (mac && !other) return 'this Mac'
	return 'this computer'
}

function listed(folders: readonly string[]): string {
	return folders.slice(0, 3).map(base_name).join(', ')
}

/** The sync-status line next to the conflict note. */
export function kept_hidden_status(folders: readonly string[], place = sync_place()): string {
	const names = listed(folders)
	if (folders.length === 1) {
		const name = base_name(folders[0] ?? '')
		return `"${name}" stayed on ${place}: it holds hidden files (like .git) that are never synced. It is back in the cloud, empty. To remove it, delete it on ${place}.`
	}
	return `${folders.length} folders stayed on ${place}: they hold hidden files (like .git) that are never synced. They are back in the cloud, empty. To remove one, delete it on ${place}: ${names}`
}

/** One neutral toast for the pass that recreated the folders. */
export function kept_hidden_toast(folders: readonly string[], place = sync_place()): string {
	if (folders.length === 1) {
		const name = base_name(folders[0] ?? '')
		return `"${name}" stayed on ${place}: it holds hidden files (like .git) that are never synced. It is back in the cloud, empty.`
	}
	return `${folders.length} folders stayed on ${place}: they hold hidden files (like .git) that are never synced. They are back in the cloud, empty.`
}

export const KEPT_HIDDEN_CLOUD_HINT = 'This folder stayed on a computer that syncs it: it holds hidden files (like .git) that are never synced. Delete it there to remove it here.'

/** The mark stays. The hint is only for a cloud folder with no visible child. */
export function shows_kept_hidden_hint(input: {
	cloud: boolean
	embedded: boolean
	xattr_names: readonly string[]
	child_names: readonly string[]
}): boolean {
	if (!input.cloud || input.embedded) return false
	if (!input.xattr_names.includes(SYNC_KEPT_HIDDEN)) return false
	return input.child_names.every(is_hidden_entry_name)
}

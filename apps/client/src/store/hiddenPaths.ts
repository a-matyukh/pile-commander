import { useStorage } from '@vueuse/core'
import { is_mac_user_agent } from '@/services/window/trafficInset'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { normalize_workspace_id, path_separator } from '@/services/workspace/paths'
import { show_hidden_files } from './showHiddenFiles'

export const HIDDEN_PATHS_KEY = 'pile_commander_hidden_paths'

/**
 * Absolute paths this device hides the same way as dot names.
 * Display only: sync, bridge, and pack still use is_hidden_entry_name.
 */
export const hidden_paths = useStorage<string[]>(HIDDEN_PATHS_KEY, [])

/** Mac and Windows trees are case-insensitive. Linux keeps the typed case. */
export function paths_ignore_case(user_agent = typeof navigator === 'undefined' ? '' : navigator.userAgent): boolean {
	if (is_mac_user_agent(user_agent)) return true
	return /Windows/i.test(user_agent)
}

function stored_list(): string[] {
	const value = hidden_paths.value as unknown
	if (!Array.isArray(value)) return []
	return value.filter((item): item is string => typeof item === 'string')
}

/** Slash-normalized so `C:/a` and `C:\a` are one path. Case folds on Mac and Windows. */
export function hidden_path_key(path: string, ignore_case: boolean): string {
	const slashed = normalize_workspace_id(path).replace(/\\/g, '/')
	return ignore_case ? slashed.toLowerCase() : slashed
}

function expand_home(text: string, home: string): string | null {
	const root = normalize_workspace_id(home)
	if (text === '~' || text === '~/' || text === '~\\') return root
	if (!text.startsWith('~/') && !text.startsWith('~\\')) return null
	const rest = text.slice(2)
	if (rest === '') return root
	const sep = path_separator(root)
	const tail = rest.replace(/[/\\]+/g, sep).replace(/[/\\]+$/, '')
	if (!tail) return root
	if (root === '/' || root === '\\') return normalize_workspace_id(root + tail)
	return normalize_workspace_id(`${root}${sep}${tail}`)
}

function is_absolute_path(text: string): boolean {
	return text.startsWith('/') || text.startsWith('\\') || /^[A-Za-z]:[/\\]/.test(text)
}

/** Absolute path, or null when the text is relative or `~` has no home. */
export function parse_hidden_path(text: string, home: string | null): string | null {
	const trimmed = text.trim()
	if (!trimmed || trimmed.includes('\0')) return null
	if (trimmed === '~' || trimmed.startsWith('~/') || trimmed.startsWith('~\\')) {
		if (!home) return null
		return expand_home(trimmed, home)
	}
	if (!is_absolute_path(trimmed)) return null
	return normalize_workspace_id(trimmed)
}

/** This exact entry. A path does not hide its children. */
export function is_user_hidden_path(id: string): boolean {
	const ignore = paths_ignore_case()
	const key = hidden_path_key(id, ignore)
	return stored_list().some(path => hidden_path_key(path, ignore) === key)
}

/** Shown dimmed: a dot name, or a path on the list. Independent of the switch. */
export function entry_is_dimmed(name: string, id: string): boolean {
	return is_hidden_entry_name(name) || is_user_hidden_path(id)
}

/** Shown in folder views and the sidebar. The switch reveals dot names and listed paths together. */
export function entry_is_listed(name: string, id: string): boolean {
	return show_hidden_files.value || !entry_is_dimmed(name, id)
}

/** `~/Library` when the path sits under home; the absolute path otherwise. */
export function display_hidden_path(
	path: string,
	home: string | null,
	ignore_case = paths_ignore_case(),
): string {
	const shown = normalize_workspace_id(path)
	if (!home) return shown
	const shown_key = hidden_path_key(shown, false)
	const home_key = hidden_path_key(normalize_workspace_id(home), false)
	const folded_shown = ignore_case ? shown_key.toLowerCase() : shown_key
	const folded_home = ignore_case ? home_key.toLowerCase() : home_key
	if (folded_shown.length !== shown_key.length || folded_home.length !== home_key.length) return shown
	if (folded_shown === folded_home) return '~'
	const prefix = folded_home.endsWith('/') ? folded_home : `${folded_home}/`
	if (!folded_shown.startsWith(prefix)) return shown
	return `~/${shown_key.slice(prefix.length)}`
}

export type HiddenPathAdd = 'added' | 'duplicate' | 'invalid'

export function add_hidden_path(text: string, home: string | null): HiddenPathAdd {
	const parsed = parse_hidden_path(text, home)
	if (!parsed) return 'invalid'
	const ignore = paths_ignore_case()
	const key = hidden_path_key(parsed, ignore)
	const current = stored_list()
	if (current.some(path => hidden_path_key(path, ignore) === key)) return 'duplicate'
	hidden_paths.value = [...current, parsed]
	return 'added'
}

export function remove_hidden_path(path: string): void {
	const ignore = paths_ignore_case()
	const key = hidden_path_key(path, ignore)
	hidden_paths.value = stored_list().filter(item => hidden_path_key(item, ignore) !== key)
}

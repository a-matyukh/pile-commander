import { PILE_DIR_NAME } from '@pile-commander/file-manager'

/** A name the folder views hide, and that sync never uploads or downloads. */
export function is_hidden_entry_name(name: string): boolean {
	return name.startsWith('.')
}

/**
 * A trash row while hidden files are off: dot names, and anything that lived
 * under `.pile`. Cover files are not dot names, so the path is what hides them.
 */
export function is_listed_trash_row(name: string, path: string, show_hidden: boolean): boolean {
	if (show_hidden) return true
	if (is_hidden_entry_name(name)) return false
	return !path.split(/[/\\]/).includes(PILE_DIR_NAME)
}

/**
 * Finder and Windows litter. Skipped by sync, but it does not mark a folder
 * as holding hidden data: `.DS_Store` is in almost every folder on macOS.
 * `._` names are AppleDouble files on flash and network disks.
 */
const OS_JUNK_NAMES = new Set(['.DS_Store', '.localized', 'Thumbs.db'])

export function is_os_junk_name(name: string): boolean {
	return OS_JUNK_NAMES.has(name) || name.startsWith('._')
}

import { is_pile_image_file, PILE_DIR_NAME } from '@pile-commander/file-manager'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'

/** '/'-separated paths under the synced root: '' is the root itself. */

/**
 * A `.pile` folder, or a cover/background webp directly inside one.
 * Anything else under `.pile` (strokes, sync.json) stays out of sync.
 */
export function is_pile_carry_relative(relative: string): boolean {
	const parts = relative.split('/')
	const pile = parts.indexOf(PILE_DIR_NAME)
	if (pile < 0 || parts.lastIndexOf(PILE_DIR_NAME) !== pile) return false
	for (let index = 0; index < parts.length; index++) {
		if (index === pile) continue
		if (is_hidden_entry_name(parts[index]!)) return false
	}
	if (pile === parts.length - 1) return true
	return pile === parts.length - 2 && is_pile_image_file(parts[parts.length - 1]!)
}

/** True when any segment of a relative path is hidden from the folder list. */
export function is_hidden_relative(relative: string): boolean {
	if (is_pile_carry_relative(relative)) return false
	return relative.split('/').some(is_hidden_entry_name)
}

export function parent_relative(relative: string): string {
	const index = relative.lastIndexOf('/')
	return index < 0 ? '' : relative.slice(0, index)
}

export function base_name(relative: string): string {
	return relative.slice(relative.lastIndexOf('/') + 1)
}

export function depth(relative: string): number {
	return relative === '' ? 0 : relative.split('/').length
}

/** `relative` itself or anything below it. */
export function is_within(relative: string, folder: string): boolean {
	return folder === '' || relative === folder || relative.startsWith(`${folder}/`)
}

export function join_relative(folder: string, name: string): string {
	return folder ? `${folder}/${name}` : name
}

/** A cloud path ('/', '/a', '/a/b') joined with a name. */
export function join_cloud(folder_path: string, name: string): string {
	return folder_path === '/' ? `/${name}` : `${folder_path}/${name}`
}

/** A local path (either separator) under `root`, joined with a relative path. */
export function join_local(root: string, relative: string): string {
	if (!relative) return root
	const sep = root.includes('\\') ? '\\' : '/'
	const base = root.endsWith(sep) ? root.slice(0, -sep.length) : root
	return `${base}${sep}${relative.split('/').join(sep)}`
}

/** The relative path of a local path under `root`, or null when it lies elsewhere. */
export function relative_of(root: string, absolute: string): string | null {
	if (absolute === root) return ''
	const sep = root.includes('\\') ? '\\' : '/'
	const prefix = root.endsWith(sep) ? root : root + sep
	if (!absolute.startsWith(prefix)) return null
	return absolute.slice(prefix.length).split(/[/\\]/).join('/')
}

/** Names the sync never writes here: OS litter, and what a local file system cannot hold. */
const UNWRITABLE_NAMES = new Set(['.DS_Store', 'Thumbs.db', '.', '..', ''])

/** A cloud name this device can create as a file or folder name. `.pile` is the folder cover pictures live in. */
export function is_local_name(name: string): boolean {
	if (name === PILE_DIR_NAME) return true
	// eslint-disable-next-line no-control-regex
	return !is_hidden_entry_name(name) && !UNWRITABLE_NAMES.has(name) && !/[\\/\x00-\x1f\x7f]/.test(name)
}

/** The relative path of a cloud path ('/' is the root, '' here). */
export function cloud_relative(path: string): string {
	return path === '/' ? '' : path.replace(/^\//, '')
}

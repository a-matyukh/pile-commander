/** '/'-separated paths under the synced root: '' is the root itself. */

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

/** Names the sync never writes here: sidecars, OS litter, and what a local file system cannot hold. */
const UNWRITABLE_NAMES = new Set(['.pile', '.DS_Store', 'Thumbs.db', '.', '..', ''])

/** A cloud name this device can create as a file or folder name. */
export function is_local_name(name: string): boolean {
	// eslint-disable-next-line no-control-regex
	return !UNWRITABLE_NAMES.has(name) && !/[\\/\x00-\x1f\x7f]/.test(name)
}

/** The relative path of a cloud path ('/' is the root, '' here). */
export function cloud_relative(path: string): string {
	return path === '/' ? '' : path.replace(/^\//, '')
}

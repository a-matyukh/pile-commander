import type { FolderRef } from '@/domain/Drive'
import { normalize_workspace_id, path_separator } from '@/services/workspace/paths'
import { McpError, type FolderAddress } from './types'

/** `..`, an absolute path, NUL, or an empty segment cannot name an entry. */
export function parse_relative(path: string): string[] {
	if (path.includes('\0')) throw new McpError('path_outside_root')
	if (path === '') return []
	if (path.startsWith('/') || path.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(path)) {
		throw new McpError('path_outside_root')
	}
	const segments = path.split(/[/\\]/)
	if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
		throw new McpError('path_outside_root')
	}
	return segments
}

export function join_root(root_id: string, relative: string): string {
	const segments = parse_relative(relative)
	const root = normalize_workspace_id(root_id)
	if (segments.length === 0) return root
	const sep = path_separator(root)
	const tail = segments.join(sep)
	if (root === '/' || root === '\\') return root + tail
	return root + sep + tail
}

export function is_under(path: string, root: string): boolean {
	const id = normalize_workspace_id(path)
	const base = normalize_workspace_id(root)
	if (id === base) return true
	const sep = path_separator(base)
	const prefix = base === sep ? sep : base + sep
	return id.startsWith(prefix)
}

export function is_direct_child(path: string, parent: string): boolean {
	const id = normalize_workspace_id(path)
	const base = normalize_workspace_id(parent)
	const sep = path_separator(base)
	const prefix = base === sep ? sep : base + sep
	if (!id.startsWith(prefix)) return false
	const rest = id.slice(prefix.length)
	return rest !== '' && !rest.includes('/') && !rest.includes('\\')
}

export function parent_id(path: string): string | null {
	const id = normalize_workspace_id(path)
	const sep = path_separator(id)
	const index = id.lastIndexOf(sep)
	if (index < 0) return null
	if (index === 0) return sep
	return id.slice(0, index)
}

export function relative_to_root(root_id: string, absolute: string): string {
	const root = normalize_workspace_id(root_id)
	const id = normalize_workspace_id(absolute)
	if (id === root) return ''
	const sep = path_separator(root)
	const prefix = root === sep ? sep : root + sep
	if (!id.startsWith(prefix)) throw new McpError('path_outside_root')
	return id.slice(prefix.length).split(/[/\\]/).join('/')
}

export function folder_address(ref: FolderRef): FolderAddress {
	return {
		drive_id: ref.drive_id,
		root_id: normalize_workspace_id(ref.root_id),
		path: relative_to_root(ref.root_id, ref.folder_id),
	}
}

export function basename_of(path: string): string {
	const id = normalize_workspace_id(path)
	const sep = path_separator(id)
	const index = id.lastIndexOf(sep)
	return index === -1 ? id : id.slice(index + 1)
}

/** `.pile` is never visible. Other dot names follow the hidden-files setting. */
export function name_is_hidden(name: string, show_hidden: boolean): boolean {
	if (name === '.pile') return true
	return !show_hidden && name.startsWith('.')
}

export function relative_is_hidden(relative: string, show_hidden: boolean): boolean {
	return parse_relative(relative).some(segment => name_is_hidden(segment, show_hidden))
}

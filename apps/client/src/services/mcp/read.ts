import type { FolderRef } from '@/domain/Drive'
import type { EntryWithXattrs, FolderWithChildrenXattrs, Xattr } from '@pile-commander/file-manager'
import { folder_view_from_stored, stored_folder_view } from '@/domain/Widget'
import { xattrs_map } from '@/services/workspace/xattrs'
import { normalize_workspace_id } from '@/services/workspace/paths'
import {
	basename_of,
	folder_address,
	is_direct_child,
	is_under,
	join_root,
	name_is_hidden,
	parent_id,
	parse_relative,
	relative_is_hidden,
	relative_to_root,
} from './path'
import {
	FOLDER_ENTRY_LIMIT,
	McpError,
	TEXT_BYTE_LIMIT,
	TEXT_READ_LIMIT,
	type EntryBrief,
	type EntryLayout,
	type FolderAddress,
	type FolderViewName,
	type GetContextResult,
	type GetFolderResult,
	type ListBookmarksResult,
	type McpContext,
	type ReadTextArgs,
	type ReadTextResult,
} from './types'

/**
 * Read tools for a local agent. They know Drive addresses and the folder
 * store, not the MCP protocol. Slice 1.3 registers them on a Server.
 */

const VIEW_NAMES = new Set<FolderViewName>([
	'list', 'gallery', 'board', 'canvas', 'stack', 'masonry', 'slides',
])

export async function get_context(ctx: McpContext): Promise<GetContextResult> {
	require_enabled(ctx)
	const open = ctx.open
	if (!open) return { open: null }
	const address = address_of(open.ref)
	if (!address || !is_local(ctx, open.ref.drive_id)) {
		return {
			open: {
				folder: address ?? fallback_address(open.ref),
				name: basename_of(open.ref.folder_id),
				view: 'list',
				readable: false,
				selection: [],
			},
		}
	}
	const data = await folder_data(ctx, open.ref.folder_id)
	const selected = new Set(open.selection)
	return {
		open: {
			folder: address,
			name: data.name || basename_of(data.id),
			view: outward_view(xattrs_map(data.xattrs).view),
			readable: true,
			selection: visible_children(data, ctx.show_hidden)
				.filter(child => selected.has(child.id))
				.map(child => entry_brief(open.ref.root_id, child)),
		},
	}
}

export async function list_bookmarks(ctx: McpContext): Promise<ListBookmarksResult> {
	require_enabled(ctx)
	const bookmarks: ListBookmarksResult['bookmarks'] = []
	for (const ref of ctx.bookmarks) {
		if (!is_local(ctx, ref.drive_id)) continue
		const folder = address_of(ref)
		if (!folder) continue
		bookmarks.push({ folder, name: basename_of(ref.folder_id) })
	}
	return { bookmarks }
}

export async function get_folder(ctx: McpContext, folder: FolderAddress): Promise<GetFolderResult> {
	const real = await resolve_granted(ctx, folder.drive_id, folder.root_id, folder.path)
	const data = await folder_data(ctx, real)
	const visible = visible_children(data, ctx.show_hidden)
	const truncated = visible.length > FOLDER_ENTRY_LIMIT
	const shown = truncated ? visible.slice(0, FOLDER_ENTRY_LIMIT) : visible
	return {
		folder: {
			drive_id: folder.drive_id,
			root_id: normalize_workspace_id(folder.root_id),
			path: folder.path,
		},
		name: data.name || basename_of(data.id),
		view: outward_view(xattrs_map(data.xattrs).view),
		truncated,
		entries: shown.map(child => ({
			...entry_brief(folder.root_id, child, folder.path),
			...entry_layout(child.xattrs),
		})),
	}
}

export async function read_text(ctx: McpContext, args: ReadTextArgs): Promise<ReadTextResult> {
	require_inside(args.folder.path, args.path)
	const real = await resolve_granted(ctx, args.folder.drive_id, args.folder.root_id, args.path)
	const parent = parent_id(real)
	if (!parent) throw new McpError('not_text')
	const listing = await folder_data(ctx, parent)
	const child = listing.children?.find(entry => normalize_workspace_id(entry.id) === real)
	if (!child) throw new McpError('not_found')
	if (child.type !== 'file') throw new McpError('not_text')
	let size: number
	try {
		size = await ctx.entry_size(real)
	} catch (error) {
		if (error instanceof McpError) throw error
		throw new McpError('not_found')
	}
	if (size > TEXT_READ_LIMIT) throw new McpError('too_large')
	let text: string
	try {
		text = await ctx.read_file(real)
	} catch (error) {
		if (error instanceof McpError) throw error
		throw new McpError('not_found')
	}
	if (text.includes('\0')) throw new McpError('not_text')
	const bytes = new TextEncoder().encode(text)
	const truncated = bytes.byteLength > TEXT_BYTE_LIMIT
	const slice = truncated ? bytes.subarray(0, TEXT_BYTE_LIMIT) : bytes
	return {
		path: args.path,
		text: new TextDecoder().decode(slice),
		truncated,
	}
}

/** Real path of a granted entry. A symlink that leaves the root is `path_outside_root`. */
export function granted_path(
	ctx: McpContext,
	drive_id: string,
	root_id: string,
	relative: string,
): Promise<string> {
	return resolve_granted(ctx, drive_id, root_id, relative)
}

/** The folder `get_folder` would list. `propose_rename` renames its direct children. */
export async function load_granted_folder(
	ctx: McpContext,
	folder: FolderAddress,
): Promise<{ id: string; folder: FolderAddress; data: FolderWithChildrenXattrs }> {
	const id = await granted_path(ctx, folder.drive_id, folder.root_id, folder.path)
	const data = await folder_data(ctx, id)
	return {
		id,
		folder: {
			drive_id: folder.drive_id,
			root_id: normalize_workspace_id(folder.root_id),
			path: folder.path,
		},
		data,
	}
}

function require_enabled(ctx: McpContext) {
	if (!ctx.enabled) throw new McpError('mcp_disabled')
}

function is_local(ctx: McpContext, drive_id: string): boolean {
	const kind = ctx.drive_kind(drive_id)
	if (kind === null) return false
	return kind === 'local'
}

function require_local(ctx: McpContext, drive_id: string) {
	const kind = ctx.drive_kind(drive_id)
	if (kind === null) throw new McpError('not_found')
	if (kind !== 'local') throw new McpError('drive_not_in_v1')
}

/** The file path is relative to the drive root and must sit inside `folder`. */
function require_inside(folder_path: string, file_path: string) {
	parse_relative(folder_path)
	parse_relative(file_path)
	if (folder_path === '') return
	if (file_path === folder_path || file_path.startsWith(`${folder_path}/`)) return
	throw new McpError('not_allowed')
}

/**
 * Logical path, then realpath. The real path has to stay under the root,
 * and still be a bookmark (any depth) or the open folder / its direct child.
 */
async function resolve_granted(
	ctx: McpContext,
	drive_id: string,
	root_id: string,
	relative: string,
): Promise<string> {
	require_enabled(ctx)
	require_local(ctx, drive_id)
	if (relative_is_hidden(relative, ctx.show_hidden)) throw new McpError('not_allowed')
	const logical = join_root(root_id, relative)
	const real_root = await canonicalize(ctx, root_id)
	const real = await canonicalize(ctx, logical)
	if (!is_under(real, real_root)) throw new McpError('path_outside_root')
	if (!await is_granted(ctx, real)) throw new McpError('not_allowed')
	return real
}

async function is_granted(ctx: McpContext, real: string): Promise<boolean> {
	const bookmarks: string[] = []
	for (const ref of ctx.bookmarks) {
		if (!is_local(ctx, ref.drive_id)) continue
		try {
			bookmarks.push(await canonicalize(ctx, ref.folder_id))
		} catch {
			// a missing bookmark grants nothing
		}
	}
	if (bookmarks.some(root => is_under(real, root))) return true
	const open = ctx.open
	if (!open || !is_local(ctx, open.ref.drive_id)) return false
	let open_real: string
	try {
		open_real = await canonicalize(ctx, open.ref.folder_id)
	} catch {
		return false
	}
	// Already inside a bookmark: nothing outside that bookmark is granted.
	if (bookmarks.some(root => is_under(open_real, root))) return false
	return real === open_real || is_direct_child(real, open_real)
}

async function canonicalize(ctx: McpContext, path: string): Promise<string> {
	try {
		return normalize_workspace_id(await ctx.realpath(path))
	} catch (error) {
		if (error instanceof McpError) throw error
		throw new McpError('not_found')
	}
}

async function folder_data(ctx: McpContext, folder_id: string): Promise<FolderWithChildrenXattrs> {
	const loaded = ctx.loaded_folder(folder_id)
	if (loaded) return loaded
	try {
		return await ctx.load_folder(folder_id)
	} catch (error) {
		if (error instanceof McpError) throw error
		throw new McpError('not_found')
	}
}

function visible_children(folder: FolderWithChildrenXattrs, show_hidden: boolean): EntryWithXattrs[] {
	return (folder.children ?? []).filter(child => !name_is_hidden(child.name, show_hidden))
}

function entry_brief(root_id: string, child: EntryWithXattrs, parent_relative?: string): EntryBrief {
	const path = parent_relative !== undefined
		? (parent_relative === '' ? child.name : `${parent_relative}/${child.name}`)
		: relative_to_root(root_id, child.id)
	return { name: child.name, path, type: child.type }
}

function entry_layout(xattrs: Xattr[]): EntryLayout {
	const map = xattrs_map(xattrs)
	const layout: EntryLayout = {}
	if (is_position(map.position)) layout.position = { x: map.position.x, y: map.position.y }
	if (is_size(map.size)) layout.size = { width: map.size.width, height: map.size.height }
	if (typeof map.order === 'number') layout.order = map.order
	if (typeof map.is_preview === 'boolean') layout.is_preview = map.is_preview
	return layout
}

function outward_view(raw: unknown): FolderViewName {
	const stored = stored_folder_view(folder_view_from_stored(raw))
	return VIEW_NAMES.has(stored as FolderViewName) ? stored as FolderViewName : 'list'
}

function is_position(value: unknown): value is { x: number; y: number } {
	if (!value || typeof value !== 'object') return false
	const point = value as Record<string, unknown>
	return typeof point.x === 'number' && typeof point.y === 'number'
}

function is_size(value: unknown): value is { width: number; height: number } {
	if (!value || typeof value !== 'object') return false
	const size = value as Record<string, unknown>
	return typeof size.width === 'number' && typeof size.height === 'number'
}

function address_of(ref: FolderRef): FolderAddress | null {
	try {
		return folder_address(ref)
	} catch (error) {
		if (error instanceof McpError) return null
		throw error
	}
}

function fallback_address(ref: FolderRef): FolderAddress {
	return { drive_id: ref.drive_id, root_id: ref.root_id, path: '' }
}

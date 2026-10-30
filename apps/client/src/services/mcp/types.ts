import type { DriveKind, FolderRef } from '@/domain/Drive'
import type { FolderWithChildrenXattrs } from '@pile-commander/file-manager'

/** Codes the MCP tools return. No stack is part of the contract. */
export const MCP_ERROR_CODES = [
	'app_unavailable',
	'mcp_disabled',
	'drive_not_in_v1',
	'not_allowed',
	'path_outside_root',
	'not_found',
	'not_text',
	'too_large',
	'bad_request',
	'busy',
	'proposal_not_found',
] as const

export type McpErrorCode = (typeof MCP_ERROR_CODES)[number]

export class McpError extends Error {
	readonly code: McpErrorCode

	constructor(code: McpErrorCode) {
		super(code)
		this.name = 'McpError'
		this.code = code
	}
}

export type FolderAddress = {
	drive_id: string
	root_id: string
	/** Relative to the root. "" is the root. Separator is "/". */
	path: string
}

export type FolderViewName =
	| 'list' | 'gallery' | 'board' | 'canvas' | 'stack' | 'masonry' | 'slides'

export type EntryBrief = {
	name: string
	/** Relative to the drive root. */
	path: string
	type: 'file' | 'folder'
}

export type EntryLayout = {
	position?: { x: number; y: number }
	size?: { width: number; height: number }
	order?: number
	is_preview?: boolean
}

export type GetContextResult = {
	open: null | {
		folder: FolderAddress
		name: string
		view: FolderViewName
		readable: boolean
		selection: EntryBrief[]
	}
}

export type ListBookmarksResult = {
	bookmarks: { folder: FolderAddress; name: string }[]
}

export type GetFolderResult = {
	folder: FolderAddress
	name: string
	view: FolderViewName
	truncated: boolean
	entries: (EntryBrief & EntryLayout)[]
}

export type ReadTextArgs = { folder: FolderAddress; path: string }

export type ReadTextResult = { path: string; text: string; truncated: boolean }

/** What the four read functions need from the running app. No MCP types. */
export type McpContext = {
	enabled: boolean
	show_hidden: boolean
	open: { ref: FolderRef; selection: readonly string[] } | null
	bookmarks: readonly FolderRef[]
	drive_kind(drive_id: string): DriveKind | null
	/** The open store already has this folder. Null when it does not. */
	loaded_folder(folder_id: string): FolderWithChildrenXattrs | null
	load_folder(folder_id: string): Promise<FolderWithChildrenXattrs>
	read_file(file_id: string): Promise<string>
	entry_size(file_id: string): Promise<number>
	realpath(path: string): Promise<string>
}

export const FOLDER_ENTRY_LIMIT = 200
export const TEXT_BYTE_LIMIT = 64 * 1024
/** Larger files are refused before they are read. */
export const TEXT_READ_LIMIT = 8 * 1024 * 1024

import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { normalize_workspace_id } from '@/services/workspace/paths'
import { add_bookmark, is_bookmarked, remove_bookmark } from './bookmarks'
import { folder_basename, root_folder_id } from './folder_header'
import { is_legacy_browser_folder, type ExplorerTreeRoot } from './tree'

/** Which items the folder header's "⋯" menu shows for the open folder */
export type FolderMenuItems = {
	rename: boolean
	bookmarked: boolean
	show_in_finder: boolean
	move_to_trash: boolean
}

export type FolderMenuContext = {
	/** The tree root of the folder's drive; null while the tree does not list it */
	item: ExplorerTreeRoot | null
	can_write: boolean
	desktop: boolean
}

/** The open folder as a tree node, for the tree's rename and remove */
export function folder_menu_node(ref: FolderRef): WorkspaceTreeNode {
	return { id: ref.folder_id, name: folder_basename(ref.folder_id), type: 'folder' }
}

/**
 * A drive root (~, browser storage, a cloud top-level folder, a folder
 * outside ~) is neither renamed nor trashed here, as in the tree; nor is a
 * read-only folder. A legacy browser folder keeps its name: the old
 * interface finds it by its path. "Show in Finder" is the desktop's local drive only
 */
export function folder_menu_items(ref: FolderRef, context: FolderMenuContext): FolderMenuItems {
	const is_root = normalize_workspace_id(ref.folder_id) === root_folder_id(ref)
	const editable = context.can_write && !is_root && context.item !== null
	return {
		rename: editable && !is_legacy_browser_folder(context.item!, folder_menu_node(ref)),
		bookmarked: is_bookmarked(ref),
		show_in_finder: context.desktop && ref.drive_id === 'local',
		move_to_trash: editable,
	}
}

export function toggle_bookmark(ref: FolderRef): void {
	if (is_bookmarked(ref)) remove_bookmark(ref)
	else add_bookmark(ref)
}

/** Finder opens with the folder selected */
export async function reveal_in_finder(ref: FolderRef): Promise<void> {
	if (ref.drive_id !== 'local') return
	const { revealItemInDir } = await import('@tauri-apps/plugin-opener')
	await revealItemInDir(ref.folder_id)
}

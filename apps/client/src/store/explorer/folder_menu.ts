import type { Drive, FolderRef } from '@/domain/Drive'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { normalize_workspace_id } from '@/services/workspace/paths'
import { add_bookmark, is_bookmarked, remove_bookmark } from './bookmarks'
import { folder_basename, root_folder_id } from './folder_header'
import { explorer_tree, is_legacy_browser_folder, type ExplorerTreeRoot } from './tree'

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

/**
 * A new folder inside the open one, as the tree row's "New folder": the
 * tree expands the folder so the new one shows up in it
 */
export async function create_child_folder(ref: FolderRef, item: ExplorerTreeRoot | null): Promise<void> {
	if (!item) return
	const is_root = normalize_workspace_id(ref.folder_id) === root_folder_id(ref)
	await explorer_tree.create_folder(item, is_root ? null : folder_menu_node(ref))
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

/** i18n keys of the confirmation before "Move to trash" */
export type RemoveConfirmText = { title: string; description: string; confirm: string }

/**
 * "Move to trash" always asks first. A drive without a trash (browser
 * storage) deletes for good and says so
 */
export function remove_confirm_text(trash: Drive['trash']): RemoveConfirmText {
	return trash === null
		? {
			title: 'tree.delete_permanently_title',
			description: 'tree.delete_permanently_description',
			confirm: 'tree.delete_permanently',
		}
		: {
			title: 'tree.move_to_trash_title',
			description: 'tree.move_to_trash_description',
			confirm: 'menu.move_to_trash',
		}
}

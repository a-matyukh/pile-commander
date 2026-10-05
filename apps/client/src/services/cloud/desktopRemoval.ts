import { is_missing_path_error } from '@/store/helpers/fsErrors'
import { create_app_cloud_file_manager } from './cloudFileManager'
import { require_supabase } from './client'
import { board_files_folder_exists, board_root_path, list_desktop_workspaces } from './desktopBoards'
import { get_system_workspace_id } from './systemWorkspace'

/**
 * Removing a cloud desktop:
 * - the desktops row delete cascades to child workspaces (FK on delete
 *   cascade) and their entries;
 * - the loose board files live in the system workspace and need an explicit
 *   fm.remove — a soft delete (cloud trash, hard-deleted after 30 days).
 */

async function board_files_fm() {
	return create_app_cloud_file_manager(await get_system_workspace_id())
}

export type DesktopChildrenCount = {
	/** child workspaces pinned to the desktop (deleted with it, permanently) */
	workspaces: number
	/** loose files directly on the board (soft-deleted to the cloud trash) */
	files: number
}

/** Confirm-dialog data: what removing the cloud desktop takes with it. */
export async function count_desktop_children(desktop_id: string): Promise<DesktopChildrenCount> {
	const client = require_supabase()
	const tiles = await list_desktop_workspaces(client, desktop_id)
	const system_id = await get_system_workspace_id()
	// probe cheaply: folder_read on a missing path 400s (the browser logs it
	// even when the client catches); a plain select answers 200 + null
	if (!await board_files_folder_exists(client, system_id, desktop_id)) {
		return { workspaces: tiles.length, files: 0 }
	}
	const fm = create_app_cloud_file_manager(system_id)
	const files = (await fm.FolderChildren(board_root_path(desktop_id))).length
	return { workspaces: tiles.length, files }
}

/** Soft-deletes the desktop's loose files folder; a missing folder is fine. */
export async function remove_desktop_files(desktop_id: string): Promise<void> {
	const fm = await board_files_fm()
	try {
		await fm.remove(board_root_path(desktop_id))
	} catch (error) {
		if (!is_missing_path_error(error)) throw error
	}
}

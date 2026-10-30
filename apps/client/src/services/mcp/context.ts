import { invoke } from '@tauri-apps/api/core'
import type { DriveKind } from '@/domain/Drive'
import type { FileManager } from '@pile-commander/file-manager'
import { agent_access } from '@/store/agentAccess'
import app from '@/store'
import { explorer_bookmarks } from '@/store/explorer/bookmarks'
import { create_explorer_local_file_manager, explorer_drives } from '@/store/explorer/drives'
import { explorer_navigation } from '@/store/explorer/navigation'
import { show_hidden_files } from '@/store/showHiddenFiles'
import type { McpContext } from './types'

let files: FileManager | null = null

function file_manager(): FileManager {
	files ??= create_explorer_local_file_manager()
	return files
}

/** `std::fs::canonicalize` in the desktop process. Not an identity path. */
export function mcp_realpath(path: string): Promise<string> {
	return invoke<string>('mcp_realpath', { path })
}

/** The read tools' view of the running app. Access rules stay in `read.ts`. */
export function live_mcp_context(): McpContext {
	const location = explorer_navigation.location
	const workspace = app.workspace
	const open = location?.kind === 'folder'
		? {
			ref: location.ref,
			selection: workspace && workspace.opened_folder_id === location.ref.folder_id
				? [...workspace.selection]
				: [],
		}
		: null
	return {
		enabled: agent_access.value,
		show_hidden: show_hidden_files.value,
		open,
		bookmarks: [...explorer_bookmarks.value],
		drive_kind(id: string): DriveKind | null {
			return explorer_drives.drive(id)?.kind ?? null
		},
		loaded_folder(id) {
			return workspace?.resolve_folder_data(id) ?? null
		},
		load_folder(id) {
			return file_manager().folder_with_children_xattrs(id)
		},
		read_file(id) {
			return file_manager().read_text_file(id)
		},
		entry_size(id) {
			return file_manager().entry_size(id)
		},
		realpath: mcp_realpath,
	}
}

import type { WorkspaceStore } from '@/domain/Store'
import { to_folder_container } from './folderContainer'

/** A board or a canvas: it has layers and a grid with a background, as in the prototype */
export function is_spatial_folder(workspace: WorkspaceStore, folder_id: string): boolean {
	const folder = workspace.folders[folder_id]
	const view = folder ? to_folder_container(folder, workspace.preview_folders).view : null
	return view === 'board' || view === 'canvas'
}

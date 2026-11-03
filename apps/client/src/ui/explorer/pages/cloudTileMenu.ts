import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceAccess } from '@pile-commander/file-manager'

/** The folder menu a right click on a cloud tile opens, at the pointer */
export type CloudTileMenu = {
	folder: FolderRef
	name: string
	/** Owner and editor may write; a viewer may not */
	can_write: boolean
	/** The same "New folder" the tree row's menu offers */
	new_folder: true
	x: number
	y: number
}

/**
 * A right click on a top-level cloud folder. `preventDefault` keeps the
 * WebView from showing its own menu (Reload, Inspect Element). The menu is
 * the tree row's: this folder, its name, and write access from the role.
 * Removing the workspace itself stays out of it.
 */
export function cloud_tile_context_menu(
	event: { preventDefault(): void; clientX: number; clientY: number },
	root: { id: string; name: string },
	role: WorkspaceAccess | null,
): CloudTileMenu {
	event.preventDefault()
	return {
		folder: { drive_id: 'cloud', root_id: root.id, folder_id: '/' },
		name: root.name,
		can_write: role === 'owner' || role === 'editor',
		new_folder: true,
		x: event.clientX,
		y: event.clientY,
	}
}

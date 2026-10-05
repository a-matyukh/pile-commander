import type { FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { FolderContainerWidget } from '@/domain/Widget'
import { find_widget_in_container } from '@/services/workspace/folderContainer'
import { find_entry_owner_folder } from '@/services/workspace/xattrs'

export function find_widget(
	folder_container: FolderContainerWidget,
	id: string,
) {
	return find_widget_in_container(folder_container, id)
}

export function widget_folder_data(
	store: {
		opened_folder: FolderWithChildrenXattrs
		preview_folders: Record<string, FolderWithChildrenXattrs>
	},
	id: string,
): FolderWithChildrenXattrs | null {
	return find_entry_owner_folder(store.opened_folder, store.preview_folders, id)
}

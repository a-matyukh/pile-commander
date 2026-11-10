import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { FolderContainerWidget } from '@/domain/Widget'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

export type FolderContainerScope = {
	folderId: ComputedRef<string>
	isEmbedded: boolean
	container: ComputedRef<FolderContainerWidget | null>
}

const folderContainerScopeKey: InjectionKey<FolderContainerScope> = Symbol('folderContainerScope')

export function provideFolderContainerScope(scope: FolderContainerScope) {
	provide(folderContainerScopeKey, scope)
}

export function createScopeFromStore(): FolderContainerScope {
	const ws = useWorkspace()

	return {
		folderId: computed(() => {
			const workspace = ws.value
			if (!workspace) {
				return ''
			}
			return workspace.opened_folder_id
		}),
		isEmbedded: false,
		container: computed(() => {
			const workspace = ws.value
			if (!workspace) {
				return null
			}
			// Track folders[opened] directly so replacing the cache entry
			// (persist / watch refresh / open_folder) always invalidates.
			const folder = workspace.folders[workspace.opened_folder_id]
			if (!folder) {
				return null
			}
			return to_folder_container(folder, workspace.preview_folders)
		}),
	}
}

export function useFolderContainerScope(): FolderContainerScope {
	const injected = inject(folderContainerScopeKey, null)
	if (injected) {
		return injected
	}
	return createScopeFromStore()
}

/**
 * Keeps the folder the scope names now, for the calling component and
 * everything below it.
 *
 * A view is one folder's (FolderViewRouter makes a new one for each), but
 * the scope above it follows the store. By the time a view unmounts, that
 * scope names the folder that replaced it: the view would clean up under the
 * next folder's id and leave its own registrations behind.
 */
export function pinFolderContainerScope(): void {
	const scope = useFolderContainerScope()
	const folder_id = scope.folderId.value
	provideFolderContainerScope({ ...scope, folderId: computed(() => folder_id) })
}

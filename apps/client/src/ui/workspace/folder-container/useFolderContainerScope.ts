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

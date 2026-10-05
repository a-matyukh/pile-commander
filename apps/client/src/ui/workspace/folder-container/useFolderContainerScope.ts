import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FolderContainerWidget, FolderView } from '@/domain/Widget'
import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspaceTile } from '@/services/cloud/desktopBoards'
import type { BridgeSource } from '@/store/bridge'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

export type FolderContainerBackgroundOverride = {
	current: ComputedRef<string | undefined>
	apply: (value: string) => void | Promise<void>
}

export type FolderContainerScope = {
	folderId: ComputedRef<string>
	isEmbedded: boolean
	container: ComputedRef<FolderContainerWidget | null>
	/**
	 * Desktop surface: the pane view is fixed (board) — the menu hides the
	 * view switcher. Background still appears when `backgroundOverride` is
	 * set (writes the desktop fill instead of the folder xattr).
	 */
	fixedView?: FolderView
	/** Extra menu groups appended to the pane context menu (desktop section). */
	menuSections?: ComputedRef<DropdownMenuItem[][]>
	/**
	 * Desktop surface: Background submenu writes this instead of the folder
	 * container xattr.
	 */
	backgroundOverride?: FolderContainerBackgroundOverride
	/**
	 * Cloud desktop boards: resolves a board node id to its workspace tile
	 * (tile roots only) so the widget gets the workspace menu (publish/share)
	 * instead of the entry-folder menu. Absent on regular folder panes.
	 */
	workspaceTileAt?: (node_id: string) => WorkspaceTile | null
	/**
	 * Local desktops: resolves a top-level folder (a workspace that opens as its
	 * own window) to the source a cloud copy reads, so the widget gets the tile
	 * menu with "Copy to cloud…". Absent on regular folder panes.
	 */
	localTileAt?: (node_id: string) => BridgeSource | null
}

const folderContainerScopeKey: InjectionKey<FolderContainerScope> = Symbol('folderContainerScope')

export function provideFolderContainerScope(scope: FolderContainerScope) {
	provide(folderContainerScopeKey, scope)
}

export function createScopeFromStore(
	options?: Pick<FolderContainerScope, 'fixedView' | 'menuSections' | 'workspaceTileAt' | 'localTileAt' | 'backgroundOverride'> & {
		/**
		 * Explicit workspace ref. Required when called in the SAME component
		 * setup that does provideWorkspaceStore: inject() there cannot see
		 * the component's own provide() and would fall back to the global
		 * store.workspace (DesktopSurface does exactly this).
		 */
		workspace?: ComputedRef<WorkspaceStore | null>
	},
): FolderContainerScope {
	const ws = options?.workspace ?? useWorkspace()

	return {
		folderId: computed(() => {
			const workspace = ws.value
			if (!workspace) {
				return ''
			}
			return workspace.opened_folder_id
		}),
		isEmbedded: false,
		fixedView: options?.fixedView,
		menuSections: options?.menuSections,
		backgroundOverride: options?.backgroundOverride,
		workspaceTileAt: options?.workspaceTileAt,
		localTileAt: options?.localTileAt,
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

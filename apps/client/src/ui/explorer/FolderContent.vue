<script setup lang="ts">
import { computed, provide, ref, watch } from 'vue'
import store from '@/store'
import { explorer_navigation } from '@/store/explorer/navigation'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import FolderActionsPanel from '@/ui/workspace/folder-container/FolderActionsPanel.vue'
import FolderContainer from '@/ui/workspace/folder-container/FolderContainer.vue'
import { provideBoardPlacement } from '@/ui/workspace/folder-container/board/boardShapePlacement'
import { useClipboardShortcuts } from '@/ui/workspace/folder-container/useClipboardShortcuts'
import { createScopeFromStore, provideFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { workspaceDialogsKey } from '@/ui/workspace/sidebar/workspaceDialogs'
import { open_publish_panel, open_share_panel } from '@/store/explorer/sharePublishPanel'
import { use_folder_keys } from './folder_keys'
import FolderPlaceholder from './FolderPlaceholder.vue'
import ListView from './views/ListView.vue'
import GalleryView from './views/GalleryView.vue'

/**
 * The open folder's content in its current view (step 3.3): the current
 * app's views inside the new interface, set up as the old window sets them
 * up. Its own "Add" and "View" are the header's; the selection panel stays
 */
const workspace = useWorkspace()
const scope = createScopeFromStore()
provideFolderContainerScope(scope)
provideBoardPlacement()
// While a cloud folder opens the old one is not on screen: its shortcuts must not touch it
const opening = computed(() => explorer_navigation.target?.kind === 'folder')
useClipboardShortcuts(
	workspace,
	() => workspace.value === store.workspace && !opening.value,
	() => scope.container.value?.children,
)
provide(workspaceDialogsKey, {
	open_publish: id => open_publish_panel(id),
	open_share: id => open_share_panel(id),
	open_trash: () => { void explorer_navigation.open_page('trash') },
})

const location = computed(() => {
	const value = explorer_navigation.location
	return value?.kind === 'folder' ? value.ref : null
})

const box = ref<HTMLElement | null>(null)
const keys_workspace = computed(() => opening.value ? null : workspace.value)
use_folder_keys(() => box.value, keys_workspace, scope.container, location)

// A double click on a folder in a view goes through the navigation, as a
// click in the tree does: the header answers at once and a cloud folder
// shows its placeholder instead of the old folder waiting for the network
watch(workspace, (ws, _old, on_cleanup) => {
	if (!ws) return
	ws.set_open_folder_hook((folder_id) => {
		const ref = location.value
		if (!ref || ws !== store.workspace) return ws.open_folder(folder_id)
		return explorer_navigation.open_folder({ ...ref, folder_id })
	})
	on_cleanup(() => ws.set_open_folder_hook(null))
}, { immediate: true })

// Anything else that opens a subfolder through the store: the Explorer
// follows, so the header, the tree, history and bookmarks know where it is
watch(() => workspace.value?.opened_folder_id, (opened) => {
	const ref = location.value
	if (!opened || !ref || explorer_navigation.navigating) return
	if (opened === ref.folder_id || workspace.value !== store.workspace) return
	void explorer_navigation.open_folder({ ...ref, folder_id: opened })
})
</script>

<template>
	<!-- The old folder goes at once, with its own shortcuts (Delete, F2, the canvas tools) -->
	<FolderPlaceholder v-if="opening" />
	<div v-else-if="location && workspace" ref="box" class="fc">
		<!-- The prototype's views replace the current ones one by one (steps 3.6–3.12) -->
		<ListView
			v-if="scope.container.value?.view === 'list'"
			:workspace="workspace"
			:container="scope.container.value"
			:location="location"
		/>
		<GalleryView
			v-else-if="scope.container.value?.view === 'grid'"
			:workspace="workspace"
			:container="scope.container.value"
			:location="location"
		/>
		<!-- The current views keep their touch actions ("Select"); List and Gallery select by tap -->
		<template v-else>
			<FolderContainer :key="workspace.uid" />
			<FolderActionsPanel />
		</template>
	</div>
</template>

<style scoped>
.fc {
	/* The current views' lines (stack rows, a slide's header) in the new interface's color */
	--pc-border: var(--border);
	position: relative;
	height: 100%;
	min-height: 0;
}
/* A canvas's grid dots and axes, as the prototype's */
.fc :deep(.vue-flow__background circle) {
	fill: var(--border-strong);
}
.fc :deep(.canvas-axes__axis) {
	stroke: var(--border-strong);
}
/* Stack rows and a slide's header: List's type, icons and left edge */
.fc :deep(.stack-row) {
	padding-left: 16px;
	padding-right: 16px;
}
.fc :deep(.stack-folder-preview-row) {
	padding: 0;
}
/* The slide switcher's "‹" lines up with the header: its button has its own 10px */
.fc :deep(.slides-header) {
	padding-left: 6px;
}
/* A preview folder's title: List's type and line */
.fc :deep(.folder-preview .folder-preview-title) {
	padding-left: 16px;
	font-size: 13px;
	color: var(--text-primary);
	border-bottom-color: var(--border);
}
.fc :deep(.stack-row-main p),
.fc :deep(.slides-header-main p) {
	font-weight: 400;
	font-size: 13px;
	color: var(--text-primary);
}
.fc :deep(.ex-row-icon) {
	font-size: 16px;
	flex: none;
}
.fc :deep(.ex-row-icon.plain) {
	color: var(--text-secondary);
}
/* The current views' "Select" and clipboard panel line up with the folder header */
.fc :deep(.folder-actions-panel) {
	top: 16px;
	left: 16px;
	max-width: calc(100% - 32px);
}
</style>

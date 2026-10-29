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
import { publish_dialog, share_dialog } from './dialogs'
import { use_folder_keys } from './folder_keys'
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
useClipboardShortcuts(
	workspace,
	() => workspace.value === store.workspace,
	() => scope.container.value?.children,
)
provide(workspaceDialogsKey, {
	open_publish: id => publish_dialog.value?.open(id),
	open_share: id => share_dialog.value?.open(id),
	open_trash: () => { void explorer_navigation.open_page('trash') },
})

const location = computed(() => {
	const value = explorer_navigation.location
	return value?.kind === 'folder' ? value.ref : null
})

const box = ref<HTMLElement | null>(null)
use_folder_keys(() => box.value, workspace, scope.container, location)

// A view opens a subfolder through the store (a double click). The Explorer
// follows, so the header, the tree, history and bookmarks know where it is
watch(() => workspace.value?.opened_folder_id, (opened) => {
	const ref = location.value
	if (!opened || !ref || explorer_navigation.navigating) return
	if (opened === ref.folder_id || workspace.value !== store.workspace) return
	void explorer_navigation.open_folder({ ...ref, folder_id: opened })
})
</script>

<template>
	<div v-if="location && workspace" ref="box" class="fc">
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
.fc :deep(.stack-folder-preview-row .folder-preview-title) {
	padding-left: 16px;
}
/* The slide switcher's "‹" lines up with the header: its button has its own 10px */
.fc :deep(.slides-header) {
	padding-left: 6px;
}
/* A preview folder's title: List's type and line */
.fc :deep(.folder-preview .folder-preview-title) {
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

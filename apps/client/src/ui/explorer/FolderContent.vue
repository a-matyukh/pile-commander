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
		<FolderContainer v-else :key="workspace.uid" />
		<FolderActionsPanel />
	</div>
</template>

<style scoped>
.fc {
	position: relative;
	height: 100%;
	min-height: 0;
}
</style>

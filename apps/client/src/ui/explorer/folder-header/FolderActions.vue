<script setup lang="ts">
import { computed } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { is_transient_drive } from '@/store/explorer/public_roots'
import { can_sync } from '@/store/explorer/share'
import AddMenu from './AddMenu.vue'
import AiMenu from './AiMenu.vue'
import BackgroundMenu from './BackgroundMenu.vue'
import LayersMenu from './LayersMenu.vue'
import FolderMenu from './FolderMenu.vue'
import PublicActions from './PublicActions.vue'
import ShareMenu from './ShareMenu.vue'
import SyncMenu from './SyncMenu.vue'
import ViewMenu from './ViewMenu.vue'

/**
 * Actions of the open folder: the view switch, "Add" (writable folders only),
 * AI, sharing, sync and the "⋯" menu. A publication or the demo is not one of
 * the user's places: it shows only its view and, for a publication, its own
 * actions (author, copy to my cloud, download, report)
 */
const props = defineProps<{ workspace: WorkspaceStore; folder: FolderRef; name: string; align: 'start' | 'end' }>()

const own = computed(() => !is_transient_drive(props.folder.drive_id))
/** A board or a canvas has layers and a grid with a background, as in the prototype */
const spatial = computed(() => {
	const folder = props.workspace.folders[props.folder.folder_id]
	const view = folder ? to_folder_container(folder, props.workspace.preview_folders).view : null
	return view === 'board' || view === 'canvas'
})
</script>

<template>
	<PublicActions v-if="folder.drive_id === 'public'" :workspace="workspace" :folder="folder" :align="align" />
	<!-- A publication keeps its author's view -->
	<ViewMenu v-if="folder.drive_id !== 'public'" :workspace="workspace" :folder_id="folder.folder_id" :align="align" />
	<AddMenu v-if="workspace.can_write" :workspace="workspace" :folder="folder" :align="align" />
	<template v-if="spatial && workspace.can_write">
		<LayersMenu :workspace="workspace" :folder_id="folder.folder_id" :align="align" />
		<BackgroundMenu :workspace="workspace" :folder_id="folder.folder_id" :align="align" />
	</template>
	<template v-if="own">
		<AiMenu :workspace="workspace" :folder_id="folder.folder_id" :name="name" :align="align" />
		<ShareMenu :folder="folder" :name="name" :align="align" />
		<SyncMenu v-if="can_sync(folder, workspace.can_write)" :folder="folder" :name="name" :align="align" />
		<FolderMenu :folder="folder" :name="name" :align="align" :can_write="workspace.can_write" />
	</template>
</template>

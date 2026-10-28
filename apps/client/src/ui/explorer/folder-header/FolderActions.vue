<script setup lang="ts">
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import AddMenu from './AddMenu.vue'
import FolderMenu from './FolderMenu.vue'
import ShareMenu from './ShareMenu.vue'
import SyncMenu from './SyncMenu.vue'
import { can_sync } from '@/store/explorer/share'
import ViewMenu from './ViewMenu.vue'

/**
 * Actions of the open folder: the view switch, "Add" (writable folders only)
 * and the "⋯" menu. The other menus of the prototype come with their own scenarios
 */
defineProps<{ workspace: WorkspaceStore; folder: FolderRef; name: string; align: 'start' | 'end' }>()
</script>

<template>
	<ViewMenu :workspace="workspace" :folder_id="folder.folder_id" :align="align" />
	<AddMenu v-if="workspace.can_write" :workspace="workspace" :folder="folder" :align="align" />
	<ShareMenu :folder="folder" :name="name" :align="align" />
	<SyncMenu v-if="can_sync(folder, workspace.can_write)" :folder="folder" :name="name" :align="align" />
	<FolderMenu :folder="folder" :name="name" :align="align" :can_write="workspace.can_write" />
</template>

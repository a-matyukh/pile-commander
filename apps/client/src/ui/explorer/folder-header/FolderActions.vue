<script setup lang="ts">
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import FolderMenu from './FolderMenu.vue'
import ViewMenu from './ViewMenu.vue'

/**
 * Actions of the open folder: the view switch and the "⋯" menu. The other
 * menus of the prototype come with their own scenarios
 */
defineProps<{ workspace: WorkspaceStore; folder: FolderRef; name: string; align: 'start' | 'end' }>()
</script>

<template>
	<ViewMenu :workspace="workspace" :folder_id="folder.folder_id" :align="align" />
	<FolderMenu :folder="folder" :name="name" :align="align" :can_write="workspace.can_write" />
</template>

<script setup lang="ts">
import type { WorkspaceStore } from '@/domain/Store'
import ViewMenu from './ViewMenu.vue'

/**
 * Actions of the open folder. Step 3.1 brings the view switch only; the
 * other menus of the prototype come with their own scenarios
 */
defineProps<{ workspace: WorkspaceStore; folder_id: string; align: 'start' | 'end' }>()
</script>

<template>
	<ViewMenu :workspace="workspace" :folder_id="folder_id" :align="align" />
</template>

<script setup lang="ts">
import { ref } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import BackgroundItems from './BackgroundItems.vue'

/**
 * The "⋯" menu where the folder has no other items for it (the demo): Grid
 * and Background, the two submenus the user's own folders have in their
 * "⋯" (FolderMenu.vue). The same button, so the header looks the same
 */
defineProps<{ workspace: WorkspaceStore; folder_id: string; align: 'start' | 'end' }>()

const open = ref(false)
</script>

<template>
	<DropMenu v-model:open="open" :width="240" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:dots"
				:aria-label="t('actions.folder_menu')"
				:data-tip="t('actions.folder_menu')"
			/>
		</template>
		<BackgroundItems :workspace="workspace" :folder_id="folder_id" />
	</DropMenu>
</template>

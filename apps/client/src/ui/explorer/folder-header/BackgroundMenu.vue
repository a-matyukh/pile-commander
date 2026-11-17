<script setup lang="ts">
import { ref } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import BackgroundItems from './BackgroundItems.vue'

/**
 * "Grid and background" as a button of its own: only where the folder has no
 * "⋯" menu to hold them (the demo). The user's own folders have them there
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
				icon="tabler:background"
				:icon_size="18"
				:aria-label="t('actions.background')"
				:data-tip="t('actions.background')"
			/>
		</template>
		<BackgroundItems :workspace="workspace" :folder_id="folder_id" />
	</DropMenu>
</template>

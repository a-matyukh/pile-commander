<script setup lang="ts">
import { ref } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import AiItems from './AiItems.vue'

/** "AI" in the folder header: the folder's AI actions (AiItems) */
defineProps<{ workspace: WorkspaceStore; folder_id: string; name: string; align: 'start' | 'end' }>()

const open = ref(false)
</script>

<template>
	<DropMenu v-model:open="open" :width="300" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:text-scan-ai"
				:icon_size="18"
				:aria-label="t('actions.ai')"
				:data-tip="t('actions.ai')"
			/>
		</template>
		<AiItems :workspace="workspace" :folder_id="folder_id" :name="name" />
	</DropMenu>
</template>

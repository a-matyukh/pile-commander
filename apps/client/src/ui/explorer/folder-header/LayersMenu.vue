<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { explorer_mobile } from '@/store/explorer/sidebar'
import { dock_layers, layers_docked, layers_panel_open, toggle_layers_panel } from '@/store/explorer/layers_panel'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import LayersList from './LayersList.vue'

/**
 * "Layers" of a board or a canvas, as in the prototype. On a wide window the
 * list can be pinned to the right: then this button shows and hides that
 * panel instead of opening the dropdown.
 */
const props = defineProps<{ workspace: WorkspaceStore; folder: FolderRef; align: 'start' | 'end' }>()

const open = ref(false)
const docked = computed(() => layers_docked.value && !explorer_mobile.value)

function pin() {
	open.value = false
	dock_layers()
}
</script>

<template>
	<IconButton
		v-if="docked"
		class="hb"
		:active="layers_panel_open"
		icon="tabler:stack-2"
		:icon_size="18"
		:aria-label="t('actions.layers')"
		:aria-pressed="layers_panel_open"
		:data-tip="t('actions.layers')"
		@click="toggle_layers_panel"
	/>
	<DropMenu v-else v-model:open="open" :width="260" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:stack-2"
				:icon_size="18"
				:aria-label="t('actions.layers')"
				:data-tip="t('actions.layers')"
			/>
		</template>
		<MenuLabel>
			<span class="tl">{{ t('layers.title') }}</span>
			<IconButton
				v-if="!explorer_mobile"
				class="pin"
				icon="tabler:layout-sidebar-right"
				:label="t('layers.dock')"
				@click="pin"
			/>
		</MenuLabel>
		<LayersList :workspace="props.workspace" :folder="props.folder" as="menu" />
	</DropMenu>
</template>

<style scoped>
.tl {
	flex: 1;
}
.pin {
	margin-right: -4px;
}
</style>

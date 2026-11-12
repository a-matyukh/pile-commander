<script setup lang="ts">
import type { Position } from '@/domain/Widget'
import { set_pile_image } from '@/services/workspace/choosePileImage'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerMenuItems } from './useFolderContainerMenuItems'
import ItemsCtxMenu from '@/ui/kit/ItemsCtxMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import { t } from '@/i18n'
import ColorPanel from '@/ui/explorer/folder-header/ColorPanel.vue'

const props = defineProps<{
	loading?: boolean
	position?: Position | null
	/** Read-only panes render no menu at all (every item would be disabled). */
	disabled?: boolean
}>()

const { folderId } = useFolderContainerScope()
const workspace = useWorkspace()

async function choose_background() {
	const ws = workspace.value
	const folder_id = folderId.value
	if (!ws) return
	// on screen at once; the upload and the attribute follow
	await set_pile_image(ws, folder_id, 'background', (token, after) => ws.change_background(folder_id, token, { after }))
}

const {
	items,
	background,
	gridSize,
	onGridSizeChange,
	applyColor,
} = useFolderContainerMenuItems({
	position: () => props.position,
	loading: () => props.loading,
})
</script>

<template>
	<ItemsCtxMenu v-if="!props.disabled" :items="items" :width="240">
		<slot />
		<template #explorer-color>
			<ColorPanel
				:value="background"
				:label="t('style.background_color')"
				picture
				:choose="workspace?.pile_images === true"
				:reset_label="t('style.remove_background')"
				@set="value => void applyColor(value)"
				@choose="choose_background"
			/>
		</template>
		<template #view-trailing="{ item }">{{ view_label((item as { currentViewLabel?: string }).currentViewLabel) }}</template>
		<template #grid-size-trailing>
			<UInput
				:model-value="gridSize"
				type="number"
				min="1"
				class="w-16"
				@click.stop
				@keydown.stop
				@update:model-value="onGridSizeChange"
			/>
		</template>
	</ItemsCtxMenu>
	<slot v-else />
</template>

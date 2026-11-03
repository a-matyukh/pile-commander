<script setup lang="ts">
import { choose_pile_image } from '@/services/workspace/choosePileImage'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useFolderContainerMenuItems } from '@/ui/workspace/menu/useFolderContainerMenuItems'
import { useFolderContainerScope } from './useFolderContainerScope'
import ItemsDropMenu from '@/ui/kit/ItemsDropMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import { resolvePaneCenterPosition } from './panePosition'
import { t } from '@/i18n'
import ColorPanel from '@/ui/explorer/folder-header/ColorPanel.vue'

const { folderId } = useFolderContainerScope()
const workspace = useWorkspace()

async function choose_background() {
	const ws = workspace.value
	if (!ws) return
	const token = await choose_pile_image(ws, folderId.value, 'background')
	if (token) await ws.change_background(folderId.value, token)
}

const {
	items,
	background,
	gridSize,
	onGridSizeChange,
	applyColor,
} = useFolderContainerMenuItems({
	position: () => resolvePaneCenterPosition(folderId.value),
})
</script>

<template>
	<ItemsDropMenu :items="items">
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
		<template #toolbar-side-trailing="{ item }">{{ item_look((item as { currentSideLabel?: string }).currentSideLabel ?? '').label }}</template>
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
	</ItemsDropMenu>
</template>

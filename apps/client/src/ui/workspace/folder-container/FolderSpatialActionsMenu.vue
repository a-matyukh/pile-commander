<script setup lang="ts">
import { useFolderContainerMenuItems } from '@/ui/workspace/menu/useFolderContainerMenuItems'
import { useFolderContainerScope } from './useFolderContainerScope'
import ItemsDropMenu from '@/ui/kit/ItemsDropMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import { resolvePaneCenterPosition } from './panePosition'
import { t } from '@/i18n'
import ColorPanel from '@/ui/explorer/folder-header/ColorPanel.vue'

const { folderId } = useFolderContainerScope()

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
				:reset_label="t('style.remove_background')"
				@set="value => void applyColor(value)"
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

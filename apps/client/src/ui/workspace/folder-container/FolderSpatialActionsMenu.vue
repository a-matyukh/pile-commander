<script setup lang="ts">
import BackgroundValueMenuSlot from '@/ui/workspace/menu/BackgroundValueMenuSlot.vue'
import ColorPickerMenuSlot from '@/ui/workspace/menu/ColorPickerMenuSlot.vue'
import MenuSwatchDot from '@/ui/workspace/menu/MenuSwatchDot.vue'
import PresetColorsMenuSlot from '@/ui/workspace/menu/PresetColorsMenuSlot.vue'
import ViewMenuTrailing from '@/ui/workspace/menu/ViewMenuTrailing.vue'
import { useFolderContainerMenuItems } from '@/ui/workspace/menu/useFolderContainerMenuItems'
import { useFolderContainerScope } from './useFolderContainerScope'
import { explorer_mounted } from '@/store/explorer/public_view'
import ItemsDropMenu from '@/ui/kit/ItemsDropMenu.vue'
import { item_look, view_label } from '@/ui/kit/items_menu_labels'
import { resolvePaneCenterPosition } from './panePosition'
import { t } from '@/i18n'
import ColorPanel from '@/ui/explorer/folder-header/ColorPanel.vue'

defineProps<{
	compact?: boolean
}>()

const { folderId } = useFolderContainerScope()

const {
	items,
	background,
	gridSize,
	onGridSizeChange,
	pickerColor,
	onPickerPointerDown,
	commitPickerColor,
	customValue,
	commitCustomValue,
	applyColor,
} = useFolderContainerMenuItems({
	position: () => resolvePaneCenterPosition(folderId.value),
})
</script>

<template>
	<!-- In the Explorer the same items, in its own menu style -->
	<ItemsDropMenu v-if="explorer_mounted" :items="items">
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
		<template #preset-colors>
			<PresetColorsMenuSlot :apply-color="applyColor" />
		</template>
		<template #color-picker>
			<ColorPickerMenuSlot
				v-model="pickerColor"
				:on-picker-pointer-down="onPickerPointerDown"
				:commit-picker-color="commitPickerColor"
				:show-hex-input="false"
			/>
		</template>
		<template #background-value>
			<BackgroundValueMenuSlot
				v-model="customValue"
				:commit-custom-value="commitCustomValue"
			/>
		</template>
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
	<UDropdownMenu
		v-else
		:items="items"
		:content="{
			align: 'start',
			side: 'bottom',
			sideOffset: 8,
		}"
		:ui="{
			content: 'min-w-56',
		}"
	>
		<UButton
			icon="i-lucide-ellipsis"
			color="neutral"
			variant="ghost"
			:size="compact ? 'xs' : 'sm'"
			aria-label="Create"
			title="Create"
		/>

		<template #item-leading="{ item }">
			<MenuSwatchDot :color="(item as { swatch?: string }).swatch" />
		</template>

		<template #view-trailing="{ item }">
			<ViewMenuTrailing :label="(item as { currentViewLabel?: string }).currentViewLabel" />
		</template>

		<template #toolbar-side-trailing="{ item }">
			<ViewMenuTrailing :label="(item as { currentSideLabel?: string }).currentSideLabel" />
		</template>

		<template #preset-colors>
			<PresetColorsMenuSlot :apply-color="applyColor" />
		</template>

		<template #color-picker>
			<ColorPickerMenuSlot
				v-model="pickerColor"
				:on-picker-pointer-down="onPickerPointerDown"
				:commit-picker-color="commitPickerColor"
				:show-hex-input="false"
			/>
		</template>

		<template #background-value>
			<BackgroundValueMenuSlot
				v-model="customValue"
				:commit-custom-value="commitCustomValue"
			/>
		</template>

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
	</UDropdownMenu>
</template>

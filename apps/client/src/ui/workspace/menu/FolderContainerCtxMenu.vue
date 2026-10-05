<script setup lang="ts">
import type { Position } from '@/domain/Widget'
import BackgroundValueMenuSlot from './BackgroundValueMenuSlot.vue'
import ColorPickerMenuSlot from './ColorPickerMenuSlot.vue'
import MenuSwatchDot from './MenuSwatchDot.vue'
import PresetColorsMenuSlot from './PresetColorsMenuSlot.vue'
import ViewMenuTrailing from './ViewMenuTrailing.vue'
import { useFolderContainerMenuItems } from './useFolderContainerMenuItems'

const props = defineProps<{
	loading?: boolean
	position?: Position | null
	/** Read-only panes render no menu at all (every item would be disabled). */
	disabled?: boolean
}>()

const {
	items,
	gridSize,
	onGridSizeChange,
	pickerColor,
	onPickerPointerDown,
	commitPickerColor,
	customValue,
	commitCustomValue,
	applyColor,
} = useFolderContainerMenuItems({
	position: () => props.position,
	loading: () => props.loading,
})
</script>

<template>
	<UContextMenu
		v-if="!props.disabled"
		:modal="false"
		:items="items"
		:ui="{
			content: 'min-w-56',
		}"
	>
		<slot />

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
	</UContextMenu>
	<slot v-else />
</template>
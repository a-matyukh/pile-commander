<script setup lang="ts">
import type { Color } from '@/domain/Widget'
import { PRESET_COLORS } from './useColorSubmenu'
import MenuSwatchDot from './MenuSwatchDot.vue'

const props = defineProps<{
	applyColor: (color: Color) => void
	disabled?: boolean
}>()
</script>

<template>
	<div class="grid grid-cols-2 gap-x-1 p-1" @click.stop>
		<button
			v-for="preset in PRESET_COLORS"
			:key="preset.color"
			type="button"
			class="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs hover:bg-elevated disabled:opacity-50"
			:disabled="disabled"
			@click="props.applyColor(preset.color)"
		>
			<MenuSwatchDot :color="preset.color" />
			<span class="truncate">{{ preset.label }}</span>
		</button>
	</div>
</template>

<script setup lang="ts">
import type { BoardViewport } from './types'
import { useViewportLayerStyle } from './useViewportLayerStyle'

const props = defineProps<{
	pathD: string
	isDot: boolean
	color: string
	strokeWidth: number
	viewport: BoardViewport
}>()

const layerStyle = useViewportLayerStyle(() => props.viewport)
</script>

<template>
	<svg
		v-if="pathD"
		class="drawing-preview"
		:style="layerStyle"
		aria-hidden="true"
	>
		<path
			:d="pathD"
			:stroke="isDot ? 'none' : color"
			:fill="isDot ? color : 'none'"
			:stroke-width="strokeWidth"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
</template>

<style scoped>
.drawing-preview {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	z-index: 5;
}
</style>

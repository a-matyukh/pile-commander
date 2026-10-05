<script setup lang="ts">
import type { BoardViewport } from './types'
import { useViewportLayerStyle } from './useViewportLayerStyle'

const props = defineProps<{
	pathD: string
	viewport: BoardViewport
}>()

const layerStyle = useViewportLayerStyle(() => props.viewport)
</script>

<template>
	<svg
		v-if="pathD"
		class="lasso-preview"
		:style="layerStyle"
		aria-hidden="true"
	>
		<path
			:d="pathD"
			class="lasso-preview__path"
			fill="rgba(37, 99, 235, 0.1)"
			stroke="#2563eb"
			stroke-width="1.5"
			stroke-dasharray="6 4"
			stroke-linecap="round"
			stroke-linejoin="round"
		/>
	</svg>
</template>

<style scoped>
.lasso-preview {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	z-index: 6;
}
</style>

<script setup lang="ts">
import type { BoardViewport } from './drawing/types'
import { useViewportLayerStyle } from './drawing/useViewportLayerStyle'

const props = defineProps<{
	viewport: BoardViewport
}>()

const AXIS_EXTENT = 100_000

const layerStyle = useViewportLayerStyle(() => props.viewport)
</script>

<template>
	<svg
		class="canvas-axes"
		:style="layerStyle"
		aria-hidden="true"
	>
		<line
			class="canvas-axes__axis canvas-axes__axis--x"
			:x1="-AXIS_EXTENT"
			y1="0"
			:x2="AXIS_EXTENT"
			y2="0"
		/>
		<line
			class="canvas-axes__axis canvas-axes__axis--y"
			x1="0"
			:y1="-AXIS_EXTENT"
			x2="0"
			:y2="AXIS_EXTENT"
		/>
	</svg>
</template>

<style scoped>
.canvas-axes {
	position: absolute;
	left: 0;
	top: 0;
	width: 100%;
	height: 100%;
	overflow: visible;
	pointer-events: none;
	z-index: 1;
}

.canvas-axes__axis {
	stroke: rgb(156 163 175 / 0.7);
	stroke-width: 1;
	vector-effect: non-scaling-stroke;
}
</style>

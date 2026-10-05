<script setup lang="ts">
import { computed } from 'vue'
import type { Position } from '@/domain/Widget'
import {
	LINE_ARROW_SIZE,
	LINE_STROKE_WIDTH,
	SHAPE_LINE_DEFAULT_STROKE,
} from '@/services/board/shapes'
import type { BoardViewport } from './types'
import { useViewportLayerStyle } from './useViewportLayerStyle'

const props = defineProps<{
	start: Position
	end: Position
	arrow: boolean
	viewport: BoardViewport
}>()

const layerStyle = useViewportLayerStyle(() => props.viewport)

const arrowPoints = computed(() => {
	if (!props.arrow) return ''
	const dx = props.end.x - props.start.x
	const dy = props.end.y - props.start.y
	const len = Math.hypot(dx, dy)
	if (len === 0) return ''
	const ux = dx / len
	const uy = dy / len
	const px = -uy
	const py = ux
	const back = LINE_ARROW_SIZE
	const half = LINE_ARROW_SIZE * 0.55
	const baseX = props.end.x - ux * back
	const baseY = props.end.y - uy * back
	return [
		`${props.end.x},${props.end.y}`,
		`${baseX + px * half},${baseY + py * half}`,
		`${baseX - px * half},${baseY - py * half}`,
	].join(' ')
})
</script>

<template>
	<svg
		class="line-draw-preview"
		:style="layerStyle"
		aria-hidden="true"
	>
		<line
			:x1="start.x"
			:y1="start.y"
			:x2="end.x"
			:y2="end.y"
			:stroke="SHAPE_LINE_DEFAULT_STROKE"
			:stroke-width="LINE_STROKE_WIDTH"
			stroke-linecap="round"
		/>
		<polygon
			v-if="arrowPoints"
			:points="arrowPoints"
			:fill="SHAPE_LINE_DEFAULT_STROKE"
		/>
	</svg>
</template>

<style scoped>
.line-draw-preview {
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

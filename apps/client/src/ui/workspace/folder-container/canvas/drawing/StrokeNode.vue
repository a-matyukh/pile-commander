<script setup lang="ts">
import { computed } from 'vue'
import type { NodeProps } from '@vue-flow/core'
import type { StrokeNodeData } from '@/services/canvas/strokes'
import { useStrokeHighlight } from './strokeHighlight'
import { pointsToPath } from './strokePath'

const props = defineProps<NodeProps<StrokeNodeData>>()

const highlight = useStrokeHighlight()

const pathD = computed(() =>
	props.data.pathD ?? pointsToPath(props.data.points, props.data.strokeWidth),
)

const isDot = computed(() => props.data.points.length === 1)
const hitWidth = computed(() => Math.max(props.data.strokeWidth * 2, 12))

const canHighlight = computed(
	() =>
		highlight?.tool.value === 'select'
		|| highlight?.tool.value === 'eraser'
		|| highlight?.tool.value === 'lasso',
)

const isHovered = computed(
	() => canHighlight.value && highlight?.hoveredNodeId.value === props.id,
)

const isEraserMode = computed(() => highlight?.tool.value === 'eraser')

const showOutline = computed(
	() => canHighlight.value && (isHovered.value || props.selected),
)

const outlineColor = computed(() => {
	if (isEraserMode.value && isHovered.value) return '#ef4444'
	if (props.selected) return '#2563eb'
	return '#60a5fa'
})

const outlineWidth = computed(() => {
	const base = props.data.strokeWidth
	if (props.selected) return base + 10
	if (isHovered.value) return base + 7
	return base + 6
})

const outlineOpacity = computed(() => {
	if (props.selected) return 0.55
	if (isHovered.value) return 0.4
	return 0
})
</script>

<template>
	<div
		class="stroke-node"
		:class="{
			'stroke-node--interactive': canHighlight,
			'stroke-node--hovered': isHovered && !selected,
			'stroke-node--selected': selected && canHighlight,
			'stroke-node--eraser-hover': isEraserMode && isHovered,
		}"
		:style="{ width: `${data.width}px`, height: `${data.height}px` }"
	>
		<svg
			class="stroke-node__svg"
			:width="data.width"
			:height="data.height"
		>
			<path
				v-if="showOutline"
				class="stroke-node__outline"
				:d="pathD"
				:stroke="outlineColor"
				:stroke-width="outlineWidth"
				:stroke-opacity="outlineOpacity"
				stroke-linecap="round"
				stroke-linejoin="round"
				fill="none"
			/>
			<path
				class="stroke-node__line"
				:d="pathD"
				:stroke="isDot ? 'none' : data.color"
				:fill="isDot ? data.color : 'none'"
				:stroke-width="data.strokeWidth"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			<path
				class="stroke-node__hit"
				:d="pathD"
				:stroke="isDot ? 'none' : 'transparent'"
				:fill="isDot ? 'transparent' : 'none'"
				:stroke-width="hitWidth"
				stroke-linecap="round"
				stroke-linejoin="round"
				:pointer-events="isDot ? 'fill' : 'stroke'"
			/>
		</svg>
	</div>
</template>

<style scoped>
.stroke-node {
	pointer-events: all;
	border-radius: 6px;
	/* Inset chrome stays inside the node box — avoids transform trails. */
	background: transparent;
	box-shadow: none;
}

.stroke-node--hovered {
	background: rgba(96, 165, 250, 0.12);
	box-shadow: inset 0 0 0 1.5px rgba(96, 165, 250, 0.38);
}

.stroke-node--selected {
	background: rgba(37, 99, 235, 0.16);
	box-shadow: inset 0 0 0 1.5px rgba(37, 99, 235, 0.5);
}

.stroke-node--eraser-hover {
	background: rgba(239, 68, 68, 0.14);
	box-shadow: inset 0 0 0 1.5px rgba(239, 68, 68, 0.45);
}

.stroke-node__svg {
	display: block;
}

.stroke-node__outline {
	pointer-events: none;
}

.stroke-node__line {
	pointer-events: none;
}

.stroke-node__hit {
	pointer-events: stroke;
}

.stroke-node--interactive {
	cursor: pointer;
}
</style>

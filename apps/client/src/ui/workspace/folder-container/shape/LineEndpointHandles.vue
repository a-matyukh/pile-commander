<script setup lang="ts">
import { computed, inject, watch } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { is_shape_widget } from '@/services/board/layout'
import { boardSnapSettingsKey } from '../injectKeys'
import { useLineShapeMeta } from './useLineShapeMeta'
import {
	line_handle_style,
	useLineEndpointDrag,
	type LineEndpointLiveLayout,
} from './useLineEndpointDrag'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	mode: 'board' | 'canvas'
	getZoom?: () => number
	getCanvasPosition?: () => { x: number; y: number }
	getCanvasSize?: () => { width: number; height: number }
	applyCanvasLive?: (layout: LineEndpointLiveLayout) => void
}>()

const isShape = computed(() => is_shape_widget(props.widget))
const { isLine, meta } = useLineShapeMeta(() => props.widget.id, isShape)

const { onPointerDown, updateSnapFromSettings } = useLineEndpointDrag({
	widget: () => props.widget,
	meta,
	mode: props.mode,
	getZoom: props.getZoom,
	getCanvasPosition: props.getCanvasPosition,
	getCanvasSize: props.getCanvasSize,
	applyCanvasLive: props.applyCanvasLive,
})

const boardSnapSettings = inject(boardSnapSettingsKey, null)
if (boardSnapSettings) {
	watch(
		() => [
			boardSnapSettings.value.snap_to_grid,
			boardSnapSettings.value.grid_size,
		] as const,
		() => updateSnapFromSettings(),
	)
}

const startStyle = computed(() => {
	const m = meta.value
	if (!m) return {}
	return line_handle_style('start', m.flipX, m.flipY, m.axis)
})

const endStyle = computed(() => {
	const m = meta.value
	if (!m) return {}
	return line_handle_style('end', m.flipX, m.flipY, m.axis)
})
</script>

<template>
	<div
		v-if="isLine && meta"
		class="line-endpoint-handles"
		aria-hidden="true"
	>
		<button
			type="button"
			class="line-endpoint-handle board-no-drag nodrag nopan"
			:style="startStyle"
			aria-label="Move line start"
			@pointerdown="onPointerDown('start', $event)"
			@click.stop.prevent
		/>
		<button
			type="button"
			class="line-endpoint-handle board-no-drag nodrag nopan"
			:style="endStyle"
			aria-label="Move line end"
			@pointerdown="onPointerDown('end', $event)"
			@click.stop.prevent
		/>
	</div>
</template>

<style scoped>
.line-endpoint-handles {
	position: absolute;
	inset: 0;
	pointer-events: none;
	/* Above shape SVG stroke/arrowheads (overflow:visible). */
	z-index: 20;
}

.line-endpoint-handle {
	position: absolute;
	width: 14px;
	height: 14px;
	padding: 0;
	margin: 0;
	border: 2px solid #3b82f6;
	border-radius: 50%;
	background: #fff;
	box-sizing: border-box;
	transform: translate(-50%, -50%);
	pointer-events: auto;
	cursor: grab;
	touch-action: none;
}

.line-endpoint-handle:active {
	cursor: grabbing;
}
</style>

<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import type { NodeProps } from '@vue-flow/core'
import type { OnResize, OnResizeEnd, OnResizeStart } from '@vue-flow/node-resizer'
import { computed, inject } from 'vue'
import WidgetTypeSwitch from '../widgets/WidgetTypeSwitch.vue'
import ResizeHandleIcon from '../widgets/ResizeHandleIcon.vue'
import LineEndpointHandles from '../shape/LineEndpointHandles.vue'
import { useLineShapeMeta } from '../shape/useLineShapeMeta'
import {
	canvasEditorToolKey,
	canvasLineGeometryKey,
	canvasNodeResizeKey,
	canvasZoomKey,
} from '../injectKeys'
import type { CanvasNodeData } from './useCanvasNodes'
import type { LineEndpointLiveLayout } from '../shape/useLineEndpointDrag'
import { useWidgetSelection } from '../widgets/useWidgetSelection'
import { is_shape_widget } from '@/services/board/layout'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useEditingNoteId } from '../widgets/useEditingNoteId'

defineOptions({ inheritAttrs: false })

const props = defineProps<NodeProps<CanvasNodeData>>()

const workspace = useWorkspace()
const emit = defineEmits<{ updateNodeInternals: [] }>()

const nodeResizeApi = inject(canvasNodeResizeKey)
if (!nodeResizeApi) {
	throw new Error('CanvasWidgetNode requires canvasNodeResize provided by Canvas view')
}
const { onStart: onNodeResizeStart, onLive: onNodeResizeLive, onEnd: onNodeResizeEnd } =
	nodeResizeApi

const applyLineGeometry = inject(canvasLineGeometryKey, null)
const getCanvasZoom = inject(canvasZoomKey, () => 1)

const tool = inject(canvasEditorToolKey)
if (!tool) {
	throw new Error('CanvasWidgetNode requires canvasEditorTool provided by Canvas view')
}

const isShape = computed(() => is_shape_widget(props.data.widget))
const { isLine } = useLineShapeMeta(() => props.data.widget.id, isShape)
const { isSelected } = useWidgetSelection(() => props.id)
const { editingNoteId } = useEditingNoteId({ optional: true })
const isEditingThis = computed(() => editingNoteId.value === props.id)

const showConnectHandles = computed(() => tool.value === 'connect')
const showLineEndpoints = computed(
	() => isLine.value && isSelected.value && workspace.value?.can_write !== false,
)
const showResize = computed(
	() => !isLine.value && !isEditingThis.value && workspace.value?.can_write !== false,
)

function handleResizeStart({ params }: OnResizeStart) {
	onNodeResizeStart(props.id, {
		width: params.width,
		height: params.height,
	})
}

function handleResize({ params }: OnResize) {
	onNodeResizeLive(props.id, {
		width: params.width,
		height: params.height,
	})
}

function handleResizeEnd({ params }: OnResizeEnd) {
	onNodeResizeEnd(props.id, {
		width: params.width,
		height: params.height,
	})
	emit('updateNodeInternals')
}

function getZoom() {
	return getCanvasZoom()
}

function getCanvasPosition() {
	return { x: props.position.x, y: props.position.y }
}

function getCanvasSize() {
	return {
		width: props.dimensions?.width ?? props.data.widget.size?.width ?? 120,
		height: props.dimensions?.height ?? props.data.widget.size?.height ?? 24,
	}
}

function applyCanvasLive(layout: LineEndpointLiveLayout) {
	applyLineGeometry?.(props.id, {
		position: layout.position,
		size: layout.size,
	})
	emit('updateNodeInternals')
}
</script>

<template>
	<div
		class="canvas-widget-node"
		:class="{
			'canvas-widget-node--connect': showConnectHandles,
			'canvas-widget-node--line': isLine,
		}"
	>
		<Handle
			id="top-target"
			type="target"
			:position="Position.Top"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="top-source"
			type="source"
			:position="Position.Top"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="right-target"
			type="target"
			:position="Position.Right"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="right-source"
			type="source"
			:position="Position.Right"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="bottom-target"
			type="target"
			:position="Position.Bottom"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="bottom-source"
			type="source"
			:position="Position.Bottom"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="left-target"
			type="target"
			:position="Position.Left"
			class="canvas-handle nodrag nopan"
		/>
		<Handle
			id="left-source"
			type="source"
			:position="Position.Left"
			class="canvas-handle nodrag nopan"
		/>
		<NodeResizer
			v-if="showResize"
			:min-width="100"
			:min-height="50"
			:line-style="{ opacity: 0, borderWidth: 0 }"
			:handle-style="{
				opacity: 0,
				background: 'transparent',
				borderColor: 'transparent',
			}"
			@resize-start="handleResizeStart"
			@resize="handleResize"
			@resize-end="handleResizeEnd"
		/>
		<WidgetTypeSwitch
			layout="board"
			:widget="data.widget"
			:index="data.index"
		/>
		<LineEndpointHandles
			v-if="showLineEndpoints"
			:widget="data.widget"
			mode="canvas"
			:get-zoom="getZoom"
			:get-canvas-position="getCanvasPosition"
			:get-canvas-size="getCanvasSize"
			:apply-canvas-live="applyCanvasLive"
		/>
		<!-- Visual affordance only; NodeResizer owns the hit target underneath. -->
		<span
			v-if="showResize"
			class="canvas-resize-affordance"
			aria-hidden="true"
		>
			<ResizeHandleIcon />
		</span>
	</div>
</template>

<style scoped>
.canvas-widget-node {
	position: relative;
	width: 100%;
	height: 100%;
	box-sizing: border-box;
}

.canvas-widget-node--line,
.canvas-widget-node--line :deep(*) {
	pointer-events: none !important;
}

.canvas-widget-node--line :deep(.pc-line-hit) {
	pointer-events: stroke !important;
}

.canvas-widget-node--line :deep(.pc-line-head) {
	pointer-events: fill !important;
}

.canvas-widget-node--line :deep(line:not(.pc-line-hit):not(.pc-line-stroke)) {
	pointer-events: stroke !important;
}

.canvas-widget-node--line :deep(.line-endpoint-handle),
.canvas-widget-node--line :deep(.canvas-handle) {
	pointer-events: auto !important;
}

.canvas-widget-node--line.canvas-widget-node--connect :deep(.canvas-handle) {
	pointer-events: auto !important;
}

.canvas-widget-node :deep(.canvas-handle) {
	width: 1px;
	height: 1px;
	min-width: 0;
	min-height: 0;
	border: none;
	background: transparent;
	z-index: 2;
	opacity: 0;
	visibility: hidden;
	pointer-events: none;
}

.canvas-widget-node--connect :deep(.canvas-handle) {
	opacity: 1;
	visibility: visible;
	pointer-events: auto;
}

.canvas-widget-node--connect :deep(.canvas-handle)::after {
	content: '';
	position: absolute;
	top: 50%;
	left: 50%;
	width: 20px;
	height: 20px;
	translate: -50% -50%;
	border: 2px solid #64748b;
	border-radius: 50%;
	background: white;
	box-sizing: border-box;
}

.canvas-widget-node--connect :deep(.canvas-handle:hover)::after {
	border-color: #2563eb;
	background: #dbeafe;
}

.canvas-widget-node :deep(.vue-flow__resize-control.line) {
	border-color: transparent;
	z-index: 5;
	touch-action: none;
}

/*
 * Large invisible hit targets above widget content so touch can grab them.
 * Bottom-right matches board's 50×50 corner handle.
 */
.canvas-widget-node :deep(.vue-flow__resize-control.handle) {
	width: 44px;
	height: 44px;
	opacity: 0;
	background: transparent;
	border-color: transparent;
	z-index: 6;
	touch-action: none;
}

.canvas-widget-node :deep(.vue-flow__resize-control.handle.bottom.right) {
	width: 50px;
	height: 50px;
}

.canvas-resize-affordance {
	position: absolute;
	right: 0;
	bottom: 0;
	z-index: 5;
	display: flex;
	align-items: flex-end;
	justify-content: flex-end;
	width: 50px;
	height: 50px;
	padding: 4px;
	box-sizing: border-box;
	opacity: 0;
	line-height: 0;
	pointer-events: none;
	color: #64748b;
	transition: opacity 0.15s ease;
}

.canvas-resize-affordance :deep(svg) {
	width: 16px;
	height: 16px;
	display: block;
}

@media (hover: hover) {
	.canvas-widget-node:hover > .canvas-resize-affordance {
		opacity: 0.8;
	}
}

@media (hover: none) {
	.canvas-resize-affordance {
		opacity: 0.7;
	}
}
</style>

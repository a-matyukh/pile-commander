<script setup lang="ts">
import { Handle, Position } from '@vue-flow/core'
import { NodeResizeControl, NodeResizer } from '@vue-flow/node-resizer'
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
import { canvas_tool_resizes } from './useCanvasToolFlags'
import type { LineEndpointLiveLayout } from '../shape/useLineEndpointDrag'
import { useWidgetSelection } from '../widgets/useWidgetSelection'
import { is_shape_widget, is_text_widget } from '@/services/board/layout'
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
const {
	onStart: onNodeResizeStart,
	onLive: onNodeResizeLive,
	onEnd: onNodeResizeEnd,
	onTextLive: onTextResizeLive,
	onTextEnd: onTextResizeEnd,
} = nodeResizeApi

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
const isText = computed(() => is_text_widget(props.data.widget))
/** No resize zones with Connect and the drawing tools: see canvas_tool_resizes */
const toolResizes = computed(() => canvas_tool_resizes(tool.value))
// A text block's height follows its text, so it has no corner and no vertical
// handle: the left and right handles change the width, once it is selected.
const showResize = computed(
	() => toolResizes.value && !isLine.value && !isText.value && !isEditingThis.value && workspace.value?.can_write !== false,
)
const showTextResize = computed(
	() => toolResizes.value
		&& isText.value
		&& isSelected.value
		&& !isEditingThis.value
		&& workspace.value?.can_write !== false,
)
const TEXT_MIN_WIDTH = 40
const TEXT_RESIZE_SIDES = ['left', 'right'] as const

function handleTextResize({ params }: OnResize) {
	onTextResizeLive(props.id, { x: params.x, width: params.width })
}

function handleTextResizeEnd({ params }: OnResizeEnd) {
	void onTextResizeEnd(props.id, { x: params.x, width: params.width }).then(() => {
		emit('updateNodeInternals')
	})
}

function handleResizeStart({ params }: OnResizeStart) {
	onNodeResizeStart(props.id, {
		width: params.width,
		height: params.height,
	})
}

function handleResize({ params }: OnResize) {
	onNodeResizeLive(props.id, {
		x: params.x,
		y: params.y,
		width: params.width,
		height: params.height,
	})
}

function handleResizeEnd({ params }: OnResizeEnd) {
	onNodeResizeEnd(props.id, {
		x: params.x,
		y: params.y,
		width: params.width,
		height: params.height,
	})
	emit('updateNodeInternals')
}

function getZoom() {
	return getCanvasZoom()
}

/*
 * The resize hit zones live inside the zoomed node, so their CSS sizes are
 * divided by the zoom: on screen they stay the same few pixels around the
 * node's real border at any zoom.
 */
const resizeHitStyle = computed(() => ({
	'--pc-resize-inv-zoom': String(1 / (getCanvasZoom() || 1)),
}))

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
		:style="resizeHitStyle"
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
			:auto-scale="false"
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
		<template v-if="showTextResize">
			<NodeResizeControl
				v-for="side in TEXT_RESIZE_SIDES"
				:key="side"
				class="text-resize-control"
				:node-id="id"
				:position="side"
				:min-width="TEXT_MIN_WIDTH"
				:min-height="1"
				:auto-scale="false"
				@resize="handleTextResize"
				@resize-end="handleTextResizeEnd"
			>
				<span class="text-resize-pill" aria-hidden="true" />
			</NodeResizeControl>
		</template>
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

/*
 * Resize hit zones straddle the node's real border, sized in screen pixels
 * (see resizeHitStyle): edges resize one side, corners two. The side being
 * dragged is the side that moves.
 */
.canvas-widget-node {
	--pc-resize-edge: calc(8px * var(--pc-resize-inv-zoom, 1));
	--pc-resize-corner: calc(14px * var(--pc-resize-inv-zoom, 1));
}

@media (pointer: coarse) {
	.canvas-widget-node {
		--pc-resize-edge: calc(16px * var(--pc-resize-inv-zoom, 1));
		--pc-resize-corner: calc(28px * var(--pc-resize-inv-zoom, 1));
	}
}

.canvas-widget-node :deep(.vue-flow__resize-control.line) {
	border-color: transparent;
	z-index: 5;
	touch-action: none;
}

.canvas-widget-node :deep(.vue-flow__resize-control.line.left),
.canvas-widget-node :deep(.vue-flow__resize-control.line.right) {
	width: var(--pc-resize-edge);
}

.canvas-widget-node :deep(.vue-flow__resize-control.line.top),
.canvas-widget-node :deep(.vue-flow__resize-control.line.bottom) {
	height: var(--pc-resize-edge);
}

.canvas-widget-node :deep(.vue-flow__resize-control.handle:not(.text-resize-control)) {
	width: var(--pc-resize-corner);
	height: var(--pc-resize-corner);
	opacity: 0;
	background: transparent;
	border-color: transparent;
	z-index: 6;
	touch-action: none;
}

/*
 * The drawn resize mark (.canvas-resize-affordance) sits up to 20 canvas px
 * inside the corner, past the zone above: under it the node moved instead.
 * The bottom-right zone reaches over all of the mark.
 */
.canvas-widget-node :deep(.vue-flow__resize-control.handle.bottom.right:not(.text-resize-control))::before {
	content: '';
	position: absolute;
	right: 50%;
	bottom: 50%;
	width: 24px;
	height: 24px;
}

/* A text block's side handles: a visible pill on the edge, in the middle. */
.canvas-widget-node :deep(.vue-flow__resize-control.handle.text-resize-control) {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 36px;
	opacity: 1;
	background: transparent;
	border-color: transparent;
	z-index: 6;
	touch-action: none;
}

.text-resize-pill {
	width: 7px;
	height: 20px;
	border-radius: 4px;
	border: 1.5px solid var(--pc-selection-ring, #6d6ad6);
	background: #fff;
	box-sizing: border-box;
	pointer-events: none;
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

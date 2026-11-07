<script setup lang="ts">
import { computed, useTemplateRef } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import WidgetShell from './WidgetShell.vue'
import PreviewContent from './PreviewContent.vue'
import ImageFigure from './ImageFigure.vue'
import { PREVIEW_KIND_CONFIG, type PreviewKind } from './previewKinds'
import { useMenuNode } from './useMenuNode'
import { useWidgetInteraction } from './useWidgetInteraction'
import { resolveWidgetBackground } from './resolveBackground'
import { MEDIA_CHROME_FILL } from '../media/mediaChrome'
import ShapeText from '../shape/ShapeText.vue'
import { useLineShapeMeta } from '../shape/useLineShapeMeta'
import { useDoubleTap } from './useDoubleTap'
import { useEditingNoteId } from './useEditingNoteId'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	index: number
	kind: PreviewKind
	layout: 'board' | 'dashboard'
}>()

const config = computed(() => PREVIEW_KIND_CONFIG[props.kind])

const menuNode = useMenuNode(() => props.widget)

const minSize = computed(() =>
	props.layout === 'board'
		? config.value.boardMinSize
		: config.value.dashboardMinSize,
)

const extraStyle = computed(() => {
	const base: Record<string, string> = {}
	if (props.kind === 'model') {
		base.backgroundColor = 'transparent'
	}
	if (props.kind !== 'shape') {
		const bg = props.widget.background
		if (bg && bg !== 'none') {
			base.backgroundColor = resolveWidgetBackground(bg)
		}
	}
	return base
})

const { onSelectStart, onDragStart, onDblClick: openOnDblClick } = useWidgetInteraction(() => props.widget, 'open_file')

// A shape (not a line or an arrow) has text: a double click edits it; the file opens from the menu
const isShape = computed(() => props.kind === 'shape')
const { isLine } = useLineShapeMeta(() => props.widget.id, isShape)
const hasText = computed(() => isShape.value && !isLine.value)
const shapeText = useTemplateRef<{ startEditing(): void }>('shapeText')
const { editingNoteId } = useEditingNoteId({ optional: true })
const editingText = computed(() => hasText.value && editingNoteId.value === props.widget.id)

const rootClass = computed(() => ({
	[props.layout === 'board'
		? config.value.boardRootClass
		: config.value.dashboardRootClass]: true,
	// As a note's: the text selects, the resize corner hides, the canvas lifts the node
	is_edit: editingText.value,
}))

/** A selection is the board's drag gesture, but a shape's text being edited selects, as a note's. */
function onShellSelectStart(event: Event) {
	if (!editingText.value) onSelectStart(event)
}

function onDblClick(event: MouseEvent) {
	if (!hasText.value) return openOnDblClick(event)
	event.preventDefault()
	event.stopPropagation()
	if (!editingText.value) shapeText.value?.startEditing()
}

/** A touch screen: two taps on the shape edit its text, as on a note. */
const doubleTap = useDoubleTap(() => {
	if (!editingText.value) shapeText.value?.startEditing()
})

/**
 * A mouse's double click, counted here too: a hand that moves a few pixels
 * while it clicks makes the board start a drag, and the browser's dblclick
 * does not always follow. Two presses in one place, quickly, edit the text
 * on the second release.
 */
const DOUBLE_PRESS_MS = 500
const DOUBLE_PRESS_SLOP_PX = 12
let lastPress = { at: 0, x: 0, y: 0 }

function onShapePointerDown(event: PointerEvent) {
	doubleTap.onPointerDown(event)
	if (event.pointerType !== 'mouse' || event.button !== 0 || editingText.value) return
	const now = performance.now()
	const near = Math.hypot(event.clientX - lastPress.x, event.clientY - lastPress.y) <= DOUBLE_PRESS_SLOP_PX
	if (lastPress.at > 0 && now - lastPress.at <= DOUBLE_PRESS_MS && near) {
		lastPress = { at: 0, x: 0, y: 0 }
		editOnRelease(event)
		return
	}
	lastPress = { at: now, x: event.clientX, y: event.clientY }
}

/** The second press edits on its release, where it was pressed: a press that became a drag does not. */
function editOnRelease(down: PointerEvent) {
	const done = (event: PointerEvent) => {
		if (event.pointerId !== down.pointerId) return
		window.removeEventListener('pointerup', done, true)
		window.removeEventListener('pointercancel', done, true)
		if (event.type !== 'pointerup') return
		if (Math.hypot(event.clientX - down.clientX, event.clientY - down.clientY) > DOUBLE_PRESS_SLOP_PX) return
		shapeText.value?.startEditing()
	}
	window.addEventListener('pointerup', done, true)
	window.addEventListener('pointercancel', done, true)
}

/** While its text is edited, a press anywhere on the shape keeps the text focused. */
function onShapeMouseDown(event: MouseEvent) {
	if (!editingText.value) return
	if (event.target instanceof Element && event.target.closest('.ProseMirror, .shape-text')) return
	event.preventDefault()
}

const imageTitle = computed(() => props.widget.type === 'file' ? props.widget.title : undefined)
const imageDescription = computed(() => props.widget.type === 'file' ? props.widget.description : undefined)
</script>

<template>
	<WidgetShell
		:layout="layout"
		:widget="widget"
		:index="index"
		:menu-component="FileMenu"
		:menu-node="menuNode"
		:menu-props="{ isPreview: true, showPreviewToggle: true }"
		:root-class="rootClass"
		:extra-style="extraStyle"
		:min-size="minSize"
		:interactions-enabled="!editingText"
		:ignore-from="hasText ? '.resize-handle, .ProseMirror, .shape-area' : undefined"
		@selectstart="onShellSelectStart"
		@dragstart="onDragStart"
		@dblclick="onDblClick"
	>
		<ImageFigure
			v-if="kind === 'image'"
			:mode="layout === 'board' ? 'card' : 'stack'"
			:title="imageTitle"
			:description="imageDescription"
		>
			<PreviewContent :kind="kind" :file-id="widget.id" :filename="widget.name" :model-camera="widget.type === 'file' ? widget.model_camera : undefined" />
		</ImageFigure>
		<div
			v-else-if="hasText"
			class="shape-box"
			:class="{ 'shape-box--editing': editingText }"
			@pointerdown="onShapePointerDown"
			@pointerup="doubleTap.onPointerUp"
			@pointercancel="doubleTap.onPointerCancel"
			@mousedown="onShapeMouseDown"
		>
			<PreviewContent :kind="kind" :file-id="widget.id" :filename="widget.name" />
			<ShapeText ref="shapeText" :widget="widget" :grows="layout === 'board'" />
		</div>
		<PreviewContent v-else :kind="kind" :file-id="widget.id" :filename="widget.name" :model-camera="widget.type === 'file' ? widget.model_camera : undefined" />
	</WidgetShell>
</template>

<style scoped>
.shape-box {
	position: relative;
	width: 100%;
	height: 100%;
}

/* Editing a shape's text shows: a dashed frame around the shape, the caret in it. */
.shape-box--editing {
	outline: 1.5px dashed var(--pc-accent, #2182f8);
	outline-offset: 3px;
}
:deep(.video-widget),
:deep(.audio-widget),
:deep(.model-widget),
:deep(.shape-widget),
:deep(.dashboard-image-widget),
:deep(.dashboard-video-widget),
:deep(.dashboard-audio-widget),
:deep(.dashboard-model-widget),
:deep(.dashboard-shape-widget) {
	padding: 0;
	overflow: hidden;
}

/* The picture clips to the card. The heading and caption sit inside it. */
:deep(.image-widget) {
	padding: 0;
	overflow: visible;
}

:deep(.image-widget .board-widget-content) {
	overflow: visible;
	border-radius: inherit;
}

:deep(.image-widget),
:deep(.video-widget),
:deep(.audio-widget),
:deep(.model-widget),
:deep(.dashboard-image-widget),
:deep(.dashboard-video-widget),
:deep(.dashboard-audio-widget),
:deep(.dashboard-model-widget) {
	transition: border-color 0.15s ease;
}

:deep(.image-widget:hover),
:deep(.video-widget:hover),
:deep(.audio-widget:hover),
:deep(.model-widget:hover),
:deep(.dashboard-image-widget:hover),
:deep(.dashboard-video-widget:hover),
:deep(.dashboard-audio-widget:hover),
:deep(.dashboard-model-widget:hover) {
	border-color: v-bind('MEDIA_CHROME_FILL') !important;
}

:deep(.shape-widget),
:deep(.dashboard-shape-widget) {
	border-radius: 0;
}

/* The board turns text selection off on its widgets: a shape's text being edited selects. */
:deep(.shape-widget.is_edit),
:deep(.dashboard-shape-widget.is_edit) {
	cursor: default;
	user-select: text;
	-webkit-user-select: text;
}

/* A shape's text and its Inside/Frame switch may reach past the shape's box */
:deep(.shape-widget),
:deep(.shape-widget .board-widget-content) {
	overflow: visible;
}

:deep(.image-widget .board-widget-content),
:deep(.video-widget .board-widget-content),
:deep(.audio-widget .board-widget-content),
:deep(.model-widget .board-widget-content),
:deep(.shape-widget .board-widget-content) {
	height: 100%;
}

:deep(.dashboard-image-widget .dashboard-widget-content),
:deep(.dashboard-video-widget .dashboard-widget-content),
:deep(.dashboard-audio-widget .dashboard-widget-content),
:deep(.dashboard-model-widget .dashboard-widget-content),
:deep(.dashboard-shape-widget .dashboard-widget-content) {
	flex: 1;
	min-height: 0;
}

/* Full-bleed <video> paints above inner overlays — ring on the widget shell. */
:deep(.board-widget.video-widget.pc-selected),
:deep(.dashboard-widget.dashboard-video-widget.pc-selected) {
	background-color: transparent;
	box-shadow: none;
}

:deep(.board-widget.video-widget.pc-selected::after),
:deep(.dashboard-widget.dashboard-video-widget.pc-selected::after) {
	content: '';
	position: absolute;
	inset: 0;
	z-index: 10;
	pointer-events: none;
	box-shadow: inset 0 0 0 2px var(--pc-selection-ring);
	border-radius: inherit;
}
</style>

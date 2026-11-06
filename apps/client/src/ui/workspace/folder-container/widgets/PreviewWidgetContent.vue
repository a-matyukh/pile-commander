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

const rootClass = computed(() => ({
	[props.layout === 'board'
		? config.value.boardRootClass
		: config.value.dashboardRootClass]: true,
}))

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
		@selectstart="onSelectStart"
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
			@pointerdown="doubleTap.onPointerDown"
			@pointerup="doubleTap.onPointerUp"
			@pointercancel="doubleTap.onPointerCancel"
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

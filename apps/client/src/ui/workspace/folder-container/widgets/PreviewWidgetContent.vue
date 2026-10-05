<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import WidgetShell from './WidgetShell.vue'
import PreviewContent from './PreviewContent.vue'
import { PREVIEW_KIND_CONFIG, type PreviewKind } from './previewKinds'
import { useMenuNode } from './useMenuNode'
import { useWidgetInteraction } from './useWidgetInteraction'
import { resolveWidgetBackground } from './resolveBackground'
import { MEDIA_CHROME_FILL } from '../media/mediaChrome'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	index: number
	kind: PreviewKind
	layout: 'board' | 'masonry'
}>()

const config = computed(() => PREVIEW_KIND_CONFIG[props.kind])

const menuNode = useMenuNode(() => props.widget)

const rootClass = computed(() => ({
	[props.layout === 'board'
		? config.value.boardRootClass
		: config.value.masonryRootClass]: true,
}))

const minSize = computed(() =>
	props.layout === 'board'
		? config.value.boardMinSize
		: config.value.masonryMinSize,
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

const { onSelectStart, onDragStart, onDblClick } = useWidgetInteraction(() => props.widget, 'open_file')
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
		@selectstart="onSelectStart"
		@dragstart="onDragStart"
		@dblclick="onDblClick"
	>
		<PreviewContent :kind="kind" :file-id="widget.id" :filename="widget.name" :model-camera="widget.type === 'file' ? widget.model_camera : undefined" />
	</WidgetShell>
</template>

<style scoped>
:deep(.image-widget),
:deep(.video-widget),
:deep(.audio-widget),
:deep(.model-widget),
:deep(.shape-widget),
:deep(.masonry-image-widget),
:deep(.masonry-video-widget),
:deep(.masonry-audio-widget),
:deep(.masonry-model-widget),
:deep(.masonry-shape-widget) {
	padding: 0;
	overflow: hidden;
}

:deep(.image-widget),
:deep(.video-widget),
:deep(.audio-widget),
:deep(.model-widget),
:deep(.masonry-image-widget),
:deep(.masonry-video-widget),
:deep(.masonry-audio-widget),
:deep(.masonry-model-widget) {
	transition: border-color 0.15s ease;
}

:deep(.image-widget:hover),
:deep(.video-widget:hover),
:deep(.audio-widget:hover),
:deep(.model-widget:hover),
:deep(.masonry-image-widget:hover),
:deep(.masonry-video-widget:hover),
:deep(.masonry-audio-widget:hover),
:deep(.masonry-model-widget:hover) {
	border-color: v-bind('MEDIA_CHROME_FILL') !important;
}

:deep(.shape-widget),
:deep(.masonry-shape-widget) {
	border-radius: 0;
}

:deep(.image-widget .board-widget-content),
:deep(.video-widget .board-widget-content),
:deep(.audio-widget .board-widget-content),
:deep(.model-widget .board-widget-content),
:deep(.shape-widget .board-widget-content) {
	height: 100%;
}

:deep(.masonry-image-widget .masonry-widget-content),
:deep(.masonry-video-widget .masonry-widget-content),
:deep(.masonry-audio-widget .masonry-widget-content),
:deep(.masonry-model-widget .masonry-widget-content),
:deep(.masonry-shape-widget .masonry-widget-content) {
	flex: 1;
	min-height: 0;
}

/* Full-bleed <video> paints above inner overlays — ring on the widget shell. */
:deep(.board-widget.video-widget.pc-selected),
:deep(.masonry-widget.masonry-video-widget.pc-selected) {
	background-color: transparent;
	box-shadow: none;
}

:deep(.board-widget.video-widget.pc-selected::after),
:deep(.masonry-widget.masonry-video-widget.pc-selected::after) {
	content: '';
	position: absolute;
	inset: 0;
	z-index: 10;
	pointer-events: none;
	box-shadow: inset 0 0 0 2px var(--pc-selection-ring);
	border-radius: inherit;
}
</style>

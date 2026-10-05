<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidget } from '@/domain/Widget'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import LocalWorkspaceTileMenu from '@/ui/workspace/menu/LocalWorkspaceTileMenu.vue'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import WidgetShell from '../widgets/WidgetShell.vue'
import LazyFolderPreview from '../widgets/LazyFolderPreview.vue'
import { useMenuNode } from '../widgets/useMenuNode'
import { useWidgetInteraction } from '../widgets/useWidgetInteraction'
import { backgroundStyle } from '../widgets/resolveBackground'

const props = withDefaults(defineProps<{
	widget: FolderContainerWidget
	index?: number
	layout?: 'board' | 'masonry'
}>(), {
	layout: 'board',
})

const menuNode = useMenuNode(() => props.widget)

// a previewed top-level folder of a local desktop is still a workspace tile:
// it keeps the tile menu with "Copy to cloud…"
const scope = useFolderContainerScope()
const local_tile = computed(() => scope.localTileAt?.(props.widget.id) ?? null)

const menuComponent = computed(() => (local_tile.value ? LocalWorkspaceTileMenu : FolderMenu))

const menuProps = computed(() => ({
	isPreview: true,
	showPreviewToggle: true,
	...(local_tile.value ? { source: local_tile.value } : {}),
}))

const shellStyle = computed(() => backgroundStyle(props.widget.background))

const isBoard = computed(() => props.layout === 'board')

const { onSelectStart } = useWidgetInteraction(() => props.widget, 'none')
</script>

<template>
	<WidgetShell
		:layout="layout"
		:widget="widget"
		:index="index ?? 0"
		:menu-component="menuComponent"
		:menu-node="menuNode"
		:menu-props="menuProps"
		:extra-style="shellStyle"
		root-class="folder-preview-widget"
		:allow-from="isBoard ? false : undefined"
		:ignore-from="isBoard ? '.resize-handle, .board-no-drag' : undefined"
		:min-size="isBoard ? { width: 200, height: 160 } : undefined"
		:is-folder-dropzone="isBoard ? true : undefined"
		@selectstart="onSelectStart"
	>
		<LazyFolderPreview :container="widget" />
	</WidgetShell>
</template>

<style scoped>
:deep(.board-widget.folder-preview-widget) {
	padding: 0;
	overflow: hidden;
	cursor: grab;
}

:deep(.folder-preview-widget .board-widget-content),
:deep(.folder-preview-widget .masonry-widget-content) {
	display: flex;
	flex-direction: column;
}

:deep(.folder-preview-widget:active) {
	cursor: grabbing;
}

:deep(.folder-preview-widget .folder-preview-body) {
	cursor: default;
}
</style>

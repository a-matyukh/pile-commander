<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import LocalWorkspaceTileMenu from '@/ui/workspace/menu/LocalWorkspaceTileMenu.vue'
import WorkspaceTileMenu from '@/ui/workspace/menu/WorkspaceTileMenu.vue'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import WidgetShell from './WidgetShell.vue'
import { resolveWidgetBackground } from './resolveBackground'
import { splitFileName } from './fileNameParts'
import { useMenuNode } from './useMenuNode'
import { useWidgetInteraction } from './useWidgetInteraction'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	index: number
	layout: 'board' | 'masonry'
}>()

// Desktops: a folder widget that is a workspace tile root gets the workspace
// menu — publish/share on a cloud desktop, copy to cloud on a local one —
// regular entry folders the FolderMenu
const scope = useFolderContainerScope()
const workspace_tile = computed(() =>
	props.widget.type === 'file' ? null : (scope.workspaceTileAt?.(props.widget.id) ?? null),
)
const local_tile = computed(() =>
	props.widget.type === 'file' ? null : (scope.localTileAt?.(props.widget.id) ?? null),
)

const menuComponent = computed(() => {
	if (props.widget.type === 'file') return FileMenu
	if (workspace_tile.value) return WorkspaceTileMenu
	return local_tile.value ? LocalWorkspaceTileMenu : FolderMenu
})

const menuNode = useMenuNode(() => props.widget)

const menuProps = computed(() => {
	if (workspace_tile.value) return { tile: workspace_tile.value }
	const folder_props = {
		isPreview: props.widget.is_preview ?? false,
		showPreviewToggle: true,
	}
	return local_tile.value ? { ...folder_props, source: local_tile.value } : folder_props
})

const extraStyle = computed((): Record<string, string> | undefined => {
	if (props.widget.type === 'folder_cover') {
		return { backgroundColor: resolveWidgetBackground(props.widget.cover) }
	}
	if (props.widget.type === 'file' && props.widget.cover) {
		return { backgroundColor: props.widget.cover }
	}
	return undefined
})

const isFolderDropzone = computed(() => props.layout === 'board' && props.widget.type !== 'file')

const isFile = computed(() => props.widget.type === 'file')

const fileParts = computed(() =>
	isFile.value ? splitFileName(props.widget.name) : null,
)

const { onSelectStart, onDragStart, onDblClick } = useWidgetInteraction(() => props.widget, 'open')
</script>

<template>
	<WidgetShell
		:layout="layout"
		:widget="widget"
		:index="index"
		:menu-component="menuComponent"
		:menu-node="menuNode"
		:menu-props="menuProps"
		:extra-style="extraStyle"
		:is-folder-dropzone="isFolderDropzone"
		@selectstart="onSelectStart"
		@dragstart="onDragStart"
		@dblclick="onDblClick"
	>
		<div
			v-if="isFile && fileParts"
			class="default-file-content"
		>
			<p class="default-file-stem font-medium text-highlighted">
				{{ fileParts.stem }}
			</p>
			<p
				v-if="fileParts.extension"
				class="default-file-ext font-medium text-highlighted"
			>
				{{ fileParts.extension }}
			</p>
		</div>
		<div
			v-else
			class="default-folder-content"
		>
			<p class="default-folder-name font-medium text-highlighted">
				{{ widget.name }}
			</p>
		</div>
	</WidgetShell>
</template>

<style scoped>
.default-file-content {
	position: relative;
	height: 100%;
	min-height: 0;
}

.default-file-stem {
	position: absolute;
	top: 0;
	left: 0;
	max-width: 100%;
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.default-file-ext {
	position: absolute;
	right: 0;
	bottom: 0;
	max-width: 100%;
	margin: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	opacity: 0.7;
	font-size: 0.85em;
}

.default-folder-content {
	display: flex;
	align-items: center;
	justify-content: center;
	height: 100%;
	min-height: 0;
	padding: 0.25rem;
	text-align: center;
}

.default-folder-name {
	margin: 0;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 4;
	line-clamp: 4;
	word-break: break-word;
}
</style>

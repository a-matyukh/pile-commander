<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
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

const menuComponent = computed(() => {
	if (props.widget.type === 'file') return FileMenu
	return FolderMenu
})

const menuNode = useMenuNode(() => props.widget)

const menuProps = computed(() => ({
	isPreview: props.widget.is_preview ?? false,
	showPreviewToggle: true,
}))

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

<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import WidgetShell from './WidgetShell.vue'
import NoteBody from './NoteBody.vue'
import { useNoteEditor } from './useNoteEditor'
import { useMenuNode } from './useMenuNode'
import { resolveWidgetBackground } from './resolveBackground'
import { useIsCanvasWidgetLayout } from '../useIsCanvasWidgetLayout'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	index: number
	layout: 'board' | 'masonry'
}>()

const isCanvas = useIsCanvasWidgetLayout()

const {
	text,
	isEditing,
	isMarkdown,
	previewHtml,
	ensureLoaded,
	onPointerDown,
	onPointerUp,
	onPointerCancel,
	onSelectStart,
	onDragStart,
	onDblClick,
	onBlur,
} = useNoteEditor(() => props.widget.id, () => props.widget.name)

const menuNode = useMenuNode(() => props.widget)

const interactionsEnabled = computed(() => !isEditing.value)

const extraStyle = computed(() => {
	const bg = props.widget.background
	return bg && bg !== 'none'
		? { backgroundColor: resolveWidgetBackground(bg) }
		: {}
})

const rootClass = computed(() =>
	props.layout === 'board'
		? {
			'note-widget': true,
			is_edit: isEditing.value,
			nodrag: isCanvas.value && isEditing.value,
			nopan: isCanvas.value && isEditing.value,
		}
		: { 'masonry-note-widget': true, is_edit: isEditing.value },
)

const ignoreFrom = computed(() =>
	props.layout === 'board'
		? '.resize-handle, textarea'
		: 'textarea',
)
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
		:interactions-enabled="interactionsEnabled"
		:extra-style="extraStyle"
		:ignore-from="ignoreFrom"
		:min-size="{ width: 120, height: 40 }"
		@pointerdown="onPointerDown"
		@selectstart="onSelectStart"
		@dragstart="onDragStart"
		@dblclick="onDblClick"
	>
		<!--
			Pointer handlers live on the body: masonry wraps the slot in
			UContextMenu, and mobile has no reliable dblclick (double-tap).
		-->
		<div
			class="note-body-wrap"
			:class="{ 'note-body-wrap--editing': isEditing }"
			@pointerdown="onPointerDown"
			@pointerup="onPointerUp"
			@pointercancel="onPointerCancel"
			@dblclick="onDblClick"
		>
			<NoteBody
				v-model="text"
				:is-editing="isEditing"
				:is-markdown="isMarkdown"
				:preview-html="previewHtml"
				:canvas-mode="isCanvas"
				@visible="ensureLoaded"
				@blur="onBlur"
			/>
		</div>
	</WidgetShell>
</template>

<style scoped>
.note-body-wrap {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
}
.note-body-wrap--editing {
	user-select: text;
	-webkit-user-select: text;
}

:deep(.note-widget) {
	padding: 8px;
	overflow: hidden;
}
:deep(.note-widget.is_edit) {
	overflow: visible;
	box-shadow: var(--pc-edit-shadow);
	cursor: text;
	user-select: text;
	-webkit-user-select: text;
}

:deep(.masonry-note-widget) {
	padding: 8px;
}
</style>

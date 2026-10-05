<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import NoteBody from '../widgets/NoteBody.vue'
import { useNoteEditor } from '../widgets/useNoteEditor'
import { useMenuNode } from '../widgets/useMenuNode'
import { resolveWidgetBackground } from '../widgets/resolveBackground'
import StackRowChrome from './StackRowChrome.vue'

const props = defineProps<{
	widget: FolderContainerWidgetChild
}>()

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

const rowStyle = computed(() => ({
	backgroundColor: resolveWidgetBackground(props.widget.background),
}))
</script>

<template>
	<StackRowChrome
		class="stack-note-row"
		:class="{ is_edit: isEditing }"
		:style="rowStyle"
		:widget-id="widget.id"
	>
		<div
			class="stack-row-main"
			@pointerdown="onPointerDown"
			@pointerup="onPointerUp"
			@pointercancel="onPointerCancel"
			@selectstart="onSelectStart"
			@dragstart="onDragStart"
			@dblclick="onDblClick"
		>
			<NoteBody
				v-model="text"
				:is-editing="isEditing"
				:is-markdown="isMarkdown"
				:preview-html="previewHtml"
				variant="stack"
				@visible="ensureLoaded"
				@blur="onBlur"
			/>
		</div>
		<template #menu>
			<FileMenu
				:node="menuNode"
				:is-preview="widget.is_preview ?? true"
				:show-preview-toggle="true"
			/>
		</template>
	</StackRowChrome>
</template>

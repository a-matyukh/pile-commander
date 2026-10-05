<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import NoteBody from '../widgets/NoteBody.vue'
import { useNoteEditor } from '../widgets/useNoteEditor'
import { resolveWidgetBackground } from '../widgets/resolveBackground'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	selected: boolean
	cut?: boolean
}>()

const emit = defineEmits<{
	select: [event: MouseEvent]
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

const noteStyle = computed(() => {
	if (props.widget.type !== 'file') return {}
	return { backgroundColor: resolveWidgetBackground(props.widget.background) }
})

function onClick(event: MouseEvent) {
	if (isEditing.value) return
	emit('select', event)
}
</script>

<template>
	<div
		class="slides-note"
		:class="{ 'pc-selected': selected, 'pc-cut': cut, is_edit: isEditing }"
		:style="noteStyle"
		@click="onClick"
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
			@visible="ensureLoaded"
			@blur="onBlur"
		/>
	</div>
</template>

<style scoped>
.slides-note {
	flex: 1;
	overflow: auto;
	min-height: 0;
	padding: 1.5rem;
}

.slides-note.is_edit {
	box-shadow: var(--pc-edit-shadow);
	cursor: text;
	user-select: text;
	-webkit-user-select: text;
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import IconButton from '@/ui/kit/IconButton.vue'
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
	layout: 'board' | 'dashboard'
}>()

const isCanvas = useIsCanvasWidgetLayout()

const {
	text,
	isEditing,
	isMarkdown,
	previewHtml,
	canToggleTasks,
	toggleTask,
	ensureLoaded,
	onPointerDown,
	onPointerUp,
	onPointerCancel,
	onSelectStart,
	onDragStart,
	onDblClick,
	onBlur,
	openInEditor,
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
		: { 'dashboard-note-widget': true, is_edit: isEditing.value },
)

const ignoreFrom = computed(() =>
	props.layout === 'board'
		? '.resize-handle, textarea, .ProseMirror'
		: 'textarea, .ProseMirror',
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
				:can-toggle-tasks="canToggleTasks"
				:canvas-mode="isCanvas"
				@visible="ensureLoaded"
				@blur="onBlur"
				@toggle-task="toggleTask"
			/>
			<!-- ⤢: the note in the note editor. Takes no focus, so the text keeps it until then -->
			<IconButton
				v-if="isEditing && isMarkdown && layout === 'board'"
				class="note-expand nodrag nopan"
				icon="tabler:arrows-diagonal"
				:data-tip="t('note_editor.expand')"
				:aria-label="t('note_editor.expand')"
				@mousedown.prevent
				@pointerdown.stop
				@click.stop="openInEditor"
			/>
		</div>
	</WidgetShell>
</template>

<style scoped>
.note-body-wrap {
	position: relative;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
}
.note-expand {
	position: absolute;
	top: -18px;
	right: -18px;
	z-index: 2;
	background: var(--surface-3, #fff);
	border: 0.5px solid var(--border-strong, rgba(0, 0, 0, 0.2)) !important;
	border-radius: 999px;
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

:deep(.dashboard-note-widget) {
	padding: 8px;
}
</style>

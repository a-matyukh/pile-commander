<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useResizeObserver } from '@vueuse/core'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import WidgetShell from './WidgetShell.vue'
import NoteBody from './NoteBody.vue'
import { useNoteEditor } from './useNoteEditor'
import { useMenuNode } from './useMenuNode'
import { useWidgetSelection } from './useWidgetSelection'
import { resolveWidgetBackground } from './resolveBackground'
import { useIsCanvasWidgetLayout } from '../useIsCanvasWidgetLayout'
import { is_text_width_live } from '../liveTextWidth'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { board_size, is_fixed_width_text } from '@/services/board/layout'

/**
 * A note file drawn as a bare text block on the board and canvas: no card, no
 * border. The box follows the text: it grows to the right while typing and a
 * line breaks only at Enter, until the user drags a side handle; then the
 * width is fixed and the text wraps inside it. The height always follows the
 * text. A small button on a fixed block brings the automatic width back.
 * Editing, saving and the markdown preview are the note's (`useNoteEditor`,
 * `NoteBody`); the shell paints no fill until the user sets a background.
 */
const props = defineProps<{
	widget: FolderContainerWidgetChild
	index: number
	layout: 'board' | 'dashboard'
}>()

const isCanvas = useIsCanvasWidgetLayout()
const requireWorkspace = useRequireWorkspace()
const { isSelected } = useWidgetSelection(() => props.widget.id)

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
} = useNoteEditor(
	() => props.widget.id,
	() => props.widget.name,
	// Leaving a text block empty removes it (see the exit handler there).
	{ isText: true },
)

const menuNode = useMenuNode(() => props.widget)

const interactionsEnabled = computed(() => !isEditing.value)

const extraStyle = computed(() => {
	const bg = props.widget.background
	return bg && bg !== 'none'
		? { backgroundColor: resolveWidgetBackground(bg) }
		: {}
})

const isFixedWidth = computed(() => is_fixed_width_text(props.widget))
/**
 * The text wraps to the box's width: once the width is fixed, and already while
 * a side handle is dragged (before the fixed width is stored), so the text
 * follows the frame at once instead of after the release.
 */
const wrapsText = computed(() => isFixedWidth.value || is_text_width_live(props.widget.id))

const canWrite = computed(() => requireWorkspace().can_write !== false)
/** Handles and the reset button belong to a selected block that is not being typed in. */
const showControls = computed(() => isSelected.value && !isEditing.value && canWrite.value)
/** On the canvas the side handles are Vue Flow resize controls (CanvasWidgetNode). */
const showBoardHandles = computed(() => showControls.value && !isCanvas.value)
const showResetWidth = computed(() => showControls.value && isFixedWidth.value)

// `note-widget` stays on the root: the pane's click-outside exit, the edit
// shadow and the edit-mode cursor are keyed on it. `text-widget` is what
// the shell reads to paint no fill and no border.
const rootClass = computed(() => ({
	'note-widget': true,
	'text-widget': true,
	is_edit: isEditing.value,
	nodrag: isCanvas.value && isEditing.value,
	nopan: isCanvas.value && isEditing.value,
}))

// The stored size is what the board extent, the other views and a reload use;
// the box itself is laid out by its content. After a typing session (and when
// the width goes back to automatic) the measured box is written back.
const bodyRef = ref<HTMLElement | null>(null)
const boxRef = ref<HTMLElement | null>(null)
let measureDirty = false
let commitTimer: ReturnType<typeof setTimeout> | null = null

function scheduleCommit() {
	if (commitTimer !== null) clearTimeout(commitTimer)
	commitTimer = setTimeout(() => {
		commitTimer = null
		void commitMeasuredSize()
	}, 200)
}

async function commitMeasuredSize() {
	const box = boxRef.value
	if (!box || isEditing.value) return
	const width = Math.round(box.offsetWidth)
	const height = Math.round(box.offsetHeight)
	const stored = board_size(props.widget)
	measureDirty = false
	if (Math.abs(stored.width - width) <= 1 && Math.abs(stored.height - height) <= 1) return
	const ws = requireWorkspace()
	if (!ws.can_write) return
	await ws.change_size(props.widget.id, { width, height })
}

onMounted(() => {
	boxRef.value = bodyRef.value?.closest<HTMLElement>('.board-widget') ?? null
})

// A typing session ends with the final layout: measure once the preview is back.
watch(isEditing, (editing) => {
	if (editing) {
		measureDirty = true
		if (commitTimer !== null) clearTimeout(commitTimer)
		commitTimer = null
	} else if (measureDirty) {
		scheduleCommit()
	}
})

useResizeObserver(boxRef, () => {
	if (measureDirty && !isEditing.value) scheduleCommit()
})

onBeforeUnmount(() => {
	if (commitTimer !== null) clearTimeout(commitTimer)
})

async function resetWidth() {
	const ws = requireWorkspace()
	if (!ws.can_write) return
	measureDirty = true
	await ws.change_text_width(props.widget.id, 'auto')
	scheduleCommit()
}
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
		:ignore-from="'.text-resize-handle, .text-reset-width, textarea'"
		:min-size="{ width: 40, height: 24 }"
		@pointerdown="onPointerDown"
		@selectstart="onSelectStart"
		@dragstart="onDragStart"
		@dblclick="onDblClick"
	>
		<div
			ref="bodyRef"
			class="note-body-wrap"
			:class="{ 'note-body-wrap--editing': isEditing }"
			@pointerdown="onPointerDown"
			@pointerup="onPointerUp"
			@pointercancel="onPointerCancel"
			@dblclick="onDblClick"
		>
			<NoteBody
				v-model="text"
				appearance="text"
				:fixed-width="wrapsText"
				:is-editing="isEditing"
				:is-markdown="isMarkdown"
				:preview-html="previewHtml"
				:canvas-mode="isCanvas"
				@visible="ensureLoaded"
				@blur="onBlur"
			/>
		</div>
		<template v-if="showBoardHandles">
			<span class="text-resize-handle text-resize-handle--left" aria-hidden="true" />
			<span class="text-resize-handle text-resize-handle--right" aria-hidden="true" />
		</template>
		<button
			v-if="showResetWidth"
			type="button"
			class="text-reset-width nodrag nopan"
			title="Auto width"
			aria-label="Auto width"
			@pointerdown.stop
			@click.stop="resetWidth"
			@dblclick.stop
		>
			<UIcon name="i-lucide-move-horizontal" class="text-reset-width__icon" />
		</button>
	</WidgetShell>
</template>

<style scoped>
.note-body-wrap {
	min-width: 0;
	min-height: 0;
}
.note-body-wrap--editing {
	user-select: text;
	-webkit-user-select: text;
}

/* Board only: the canvas draws its own side controls. interactjs reads these
   two elements as the left and right resize edges (boardTextResize.ts). */
.text-resize-handle {
	position: absolute;
	top: 50%;
	z-index: 3;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 18px;
	height: 36px;
	transform: translateY(-50%);
	cursor: ew-resize;
	touch-action: none;
}
.text-resize-handle--left {
	left: -9px;
}
.text-resize-handle--right {
	right: -9px;
}
.text-resize-handle::before {
	content: '';
	width: 7px;
	height: 20px;
	border-radius: 4px;
	border: 1.5px solid var(--pc-selection-ring, #6d6ad6);
	background: #fff;
	box-sizing: border-box;
}

/* Right of a fixed block: one click and the width follows the text again. */
.text-reset-width {
	position: absolute;
	top: 50%;
	right: -30px;
	z-index: 3;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 22px;
	height: 22px;
	padding: 0;
	transform: translateY(-50%);
	border: 1px solid var(--pc-selection-ring, #6d6ad6);
	border-radius: 11px;
	background: #fff;
	color: var(--pc-selection-ring, #6d6ad6);
	cursor: pointer;
}
.text-reset-width:hover {
	background: #f4f3ff;
}
.text-reset-width__icon {
	width: 14px;
	height: 14px;
}
</style>

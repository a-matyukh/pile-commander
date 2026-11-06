<script setup lang="ts">
/**
 * A shape's text (stage 4 of TEXT_EDITING_PLAN.md, prototype P3): an HTML
 * layer over the SVG, centred both ways in the area inscribed in the shape
 * (or its whole frame), in the colour that reads on its fill. Resizing the
 * shape moves the text, not its size. A double click edits it with the
 * notes' engine and popup; it is kept in the shape's `text` xattr, never in
 * the SVG.
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, shallowRef, useTemplateRef, watch } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import { read_shape_color } from '@/services/board/shapes'
import { has_text_area_switch, SHAPE_TEXT_INSETS, shape_text_color, shape_text_kind } from '@/services/board/shape_text'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { armNoteKeyboardFocus, transferNoteKeyboardFocus } from '../noteKeyboardFocus'
import { useEditingNoteId } from '../widgets/useEditingNoteId'
import { useWidgetSelection } from '../widgets/useWidgetSelection'
import { loadedNoteRenderer, loadNoteEditor, loadNoteRenderer } from '../widgets/noteRenderer'
import { useShapeContent } from './useShapeContent'

const props = defineProps<{
	widget: FolderContainerWidgetChild
	/** The shape's height follows a text that does not fit (a board or a canvas; not a dashboard cell). */
	grows?: boolean
}>()

const NoteRichEditor = defineAsyncComponent(loadNoteEditor)

const workspace = useWorkspace()
const requireWorkspace = useRequireWorkspace()
const { editingNoteId, onNoteEditExit } = useEditingNoteId({ optional: true })
const { svgHtml } = useShapeContent(() => props.widget.id)

const kind = computed(() => shape_text_kind(svgHtml.value))
const area = computed(() => props.widget.type === 'file' && props.widget.text_area === 'frame' ? 'frame' : 'inset')
const color = computed(() => shape_text_color(read_shape_color(svgHtml.value)))
const text = computed(() => props.widget.type === 'file' ? props.widget.text ?? '' : '')
const editing = computed(() => editingNoteId.value === props.widget.id)
const { isSelected: selected } = useWidgetSelection(() => props.widget.id)
const canWrite = computed(() => workspace.value?.can_write !== false)

const boxStyle = computed(() => {
	const [top, right, bottom, left] = SHAPE_TEXT_INSETS[area.value][kind.value]
	return {
		top: `${top * 100}%`,
		right: `${right * 100}%`,
		bottom: `${bottom * 100}%`,
		left: `${left * 100}%`,
		color: color.value,
	}
})

// ─── Preview ───────────────────────────────────────────────────────────────

const html = shallowRef('')
let run = 0
watch(text, (markdown) => {
	const current = ++run
	if (!markdown) {
		html.value = ''
		return
	}
	const render = loadedNoteRenderer()
	if (render) {
		html.value = render(markdown, 'center')
		return
	}
	void loadNoteRenderer().then((loaded) => {
		if (current === run) html.value = loaded(markdown, 'center')
	})
}, { immediate: true })

// ─── Editing ───────────────────────────────────────────────────────────────

const draft = ref('')
const editor = useTemplateRef<{ element(): HTMLElement | null; placeCaret(point: null): void }>('editor')

watch(editing, async (now) => {
	if (!now) return
	draft.value = text.value
	await nextTick()
	for (let frame = 0; frame < 30 && editing.value; frame++) {
		const element = editor.value?.element()
		if (element) {
			editor.value?.placeCaret(null)
			// A double tap armed the soft keyboard: it moves onto the text
			transferNoteKeyboardFocus(element)
			return
		}
		await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
	}
})

const stopExit = onNoteEditExit(props.widget.id, async () => {
	if (!canWrite.value || draft.value === text.value) return
	await requireWorkspace().set_shape_text(props.widget.id, draft.value)
})
onBeforeUnmount(stopExit)

function leave() {
	if (editingNoteId.value === props.widget.id) editingNoteId.value = null
}

/** Focus left the text and its popup: editing ends, as a note's does. */
function onFocusOut() {
	requestAnimationFrame(() => {
		if (!editing.value) return
		const active = document.activeElement
		const element = editor.value?.element()
		if (element?.contains(active)) return
		if (active instanceof Element && active.closest('.note-format, [role="menu"], [data-reka-popper-content-wrapper]')) return
		leave()
	})
}

/** Double click on the shape: its text is edited (a line has none: the shell does not ask). */
function startEditing() {
	if (!canWrite.value) return
	// Inside the gesture, before anything waits: a phone opens its keyboard only then
	armNoteKeyboardFocus()
	void loadNoteEditor()
	editingNoteId.value = props.widget.id
}

// ─── Growing ───────────────────────────────────────────────────────────────

const box = useTemplateRef<HTMLElement>('box')
let growTimer: ReturnType<typeof setTimeout> | null = null

/**
 * A text taller than its area makes the shape taller, its width as it is:
 * as the text is typed, and after a resize that left it too short. It never
 * shrinks by itself.
 */
async function grow() {
	growTimer = null
	if (!props.grows || !canWrite.value) return
	const textBox = box.value
	const body = textBox?.querySelector<HTMLElement>('.shape-text-body')
	const shape = textBox?.parentElement
	if (!textBox || !body || !shape) return
	const needed = body.scrollHeight
	if (needed <= textBox.clientHeight + 1) return
	const [top, , bottom] = SHAPE_TEXT_INSETS[area.value][kind.value]
	const height = Math.ceil(needed / (1 - top - bottom)) + 2
	if (height <= shape.offsetHeight) return
	await requireWorkspace().change_size(props.widget.id, { width: Math.round(shape.offsetWidth), height })
}

function scheduleGrow() {
	if (growTimer) clearTimeout(growTimer)
	growTimer = setTimeout(() => void grow(), 120)
}

watch(
	() => [html.value, draft.value, editing.value, area.value, kind.value, props.widget.size?.width, props.widget.size?.height],
	() => void nextTick(scheduleGrow),
)

onBeforeUnmount(() => {
	if (growTimer) clearTimeout(growTimer)
})

function setArea(next: 'inset' | 'frame') {
	if (!canWrite.value || next === area.value) return
	void requireWorkspace().set_shape_text_area(props.widget.id, next === 'frame' ? 'frame' : null)
}

defineExpose({ startEditing })
</script>

<template>
	<div
		ref="box"
		class="shape-text"
		:class="{ 'shape-text--editing': editing }"
		:style="boxStyle"
	>
		<NoteRichEditor
			v-if="editing"
			ref="editor"
			v-model="draft"
			default-align="center"
			class="shape-text-body shape-text-editor note-content nodrag nopan"
			@escape="leave"
			@leave="onFocusOut"
			@focusout="onFocusOut"
			@pointerdown.stop
			@dblclick.stop
		/>
		<!-- eslint-disable-next-line vue/no-v-html -- rendered by the note schema, then sanitized -->
		<div v-else-if="html" class="shape-text-body note-content" v-html="html" />
	</div>
	<!-- On the shape under the pointer, as its resize handle, and on a selected one -->
	<div
		v-if="!editing && canWrite && has_text_area_switch(kind)"
		class="shape-area nodrag nopan"
		:class="{ 'shape-area--shown': selected }"
		role="group"
		:aria-label="t('shape_text.area')"
		@pointerdown.stop
		@mousedown.stop
		@dblclick.stop
	>
		<button type="button" :class="{ on: area === 'inset' }" @click="setArea('inset')">{{ t('shape_text.inside') }}</button>
		<button type="button" :class="{ on: area === 'frame' }" @click="setArea('frame')">{{ t('shape_text.frame') }}</button>
	</div>
</template>

<style scoped>
.shape-text {
	position: absolute;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: none;
	font-size: 14px;
	line-height: 1.35;
	text-align: center;
}

.shape-text--editing {
	pointer-events: auto;
	cursor: text;
}

.shape-text-body {
	width: 100%;
	max-height: 100%;
	overflow-wrap: anywhere;
	color: inherit;
}

.shape-text-body :deep(:where(p, h1, h2, h3, h4, h5, h6, li, blockquote, strong, em, code, pre)) {
	color: inherit;
	margin: 0;
}

.shape-text-body :deep(h1) {
	font-size: 1.5em;
	font-weight: 700;
}

.shape-text-body :deep(h2) {
	font-size: 1.25em;
	font-weight: 700;
}

.shape-text-body :deep(h3) {
	font-size: 1.1em;
	font-weight: 600;
}

.shape-text-body :deep(:where(ul, ol)) {
	margin: 0.2em 0;
	padding-inline-start: 1.2em;
	text-align: left;
}

.shape-text-body :deep(ul[data-type="taskList"]) {
	list-style: none;
	padding-inline-start: 0;
}

.shape-text-body :deep(li[data-type="taskItem"]) {
	display: flex;
	gap: 6px;
	align-items: flex-start;
}

.shape-text-body :deep(a) {
	color: inherit;
	text-decoration: underline;
}

.shape-text-body :deep(mark) {
	color: #1f1f1e;
	border-radius: 3px;
	padding: 0 0.1em;
}

.shape-text-editor :deep(.ProseMirror) {
	outline: none;
	white-space: pre-wrap;
}

.shape-area {
	position: absolute;
	top: -36px;
	left: 50%;
	transform: translateX(-50%);
	z-index: 3;
	display: none;
	gap: 2px;
	padding: 2px;
	background: var(--surface-3, #fff);
	border: 0.5px solid var(--border-strong, rgba(0, 0, 0, 0.2));
	border-radius: 8px;
	box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
	white-space: nowrap;
}

.shape-area--shown {
	display: flex;
}

/* Whole selectors in :global: Vue would keep only the part inside the parentheses */
:global(.board-widget:hover .shape-area),
:global(.canvas-widget-node:hover .shape-area) {
	display: flex;
}

.shape-area button {
	height: 24px;
	padding: 0 8px;
	border: 0;
	border-radius: 6px;
	background: none;
	color: var(--text-secondary, #555);
	font: 12px/1 inherit;
	cursor: pointer;
}

.shape-area button.on {
	background: var(--bg-accent, #eef);
	color: var(--text-accent, #335);
}
</style>

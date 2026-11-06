<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useIntersectionObserver, useResizeObserver } from '@vueuse/core'
import {
	shouldIgnoreNoteKeyboardDismiss,
	transferNoteKeyboardFocus,
} from '../noteKeyboardFocus'
import { takeEditPoint } from './editPoint'
import { loadNoteEditor, TASK_BOX } from './noteRenderer'

/**
 * `.md` is edited as rendered text; the component loads with the first edit.
 * If it cannot load (a web build replaced by a deploy), the textarea edits
 * the markdown as before.
 */
const editorFailed = ref(false)
const NoteRichEditor = defineAsyncComponent({
	loader: loadNoteEditor,
	onError(error, _retry, fail) {
		console.warn('[notes] the note editor did not load', error)
		editorFailed.value = true
		fail()
	},
})

const props = withDefaults(defineProps<{
	isEditing: boolean
	previewHtml: string
	isMarkdown?: boolean
	canvasMode?: boolean
	variant?: 'fill' | 'stack'
	/**
	 * `text`: a bare text block. Same markdown editing and preview as a note;
	 * the box is not fixed: it follows the text, in height always and in width
	 * until `fixedWidth`. No fade, nothing is cut or scrolled.
	 */
	appearance?: 'note' | 'text'
	/**
	 * Text block only. false: the box grows to the right with the text and a
	 * line breaks only at Enter. true: the width is set from outside and the
	 * text wraps inside it.
	 */
	fixedWidth?: boolean
	/** Task boxes in the preview tick tasks (the folder can be written to). */
	canToggleTasks?: boolean
}>(), {
	canToggleTasks: false,
	isMarkdown: true,
	canvasMode: false,
	variant: 'fill',
	appearance: 'note',
	fixedWidth: false,
})

const isTextAppearance = computed(() => props.appearance === 'text')
/** Stack notes grow with the text (up to a max height) instead of keeping a fixed, scrolling box. */
const growsWithText = computed(() => props.variant === 'stack')

const text = defineModel<string>({ required: true })

const emit = defineEmits<{
	blur: []
	visible: []
	toggleTask: [index: number, checked: boolean]
}>()

const textareaRef = useTemplateRef<HTMLTextAreaElement>('textarea')
const editorRef = useTemplateRef<{
	element(): HTMLElement | null
	placeCaret(point: { x: number; y: number } | null): void
}>('editor')
const previewRef = useTemplateRef<HTMLDivElement>('preview')
const isClipped = ref(false)

const richEditing = computed(() => props.isMarkdown && !editorFailed.value)

/** What takes focus while editing: the rich editor for `.md`, the textarea for `.txt`. */
function editingElement(): HTMLElement | null {
	return richEditing.value ? editorRef.value?.element() ?? null : textareaRef.value
}

/** Soft-keyboard height usually exceeds URL-bar chrome jitter. */
const KEYBOARD_VIEWPORT_GAP = 150
/** Ignore brief viewport flicker while focus moves proxy → note textarea. */
const KEYBOARD_CLOSE_DEBOUNCE_MS = 280

const { stop: stopObserver } = useIntersectionObserver(
	previewRef,
	([entry]) => {
		if (entry?.isIntersecting) {
			stopObserver()
			emit('visible')
		}
	},
)

/**
 * A click on a task box: by the time it arrives the box shows its new state.
 * Where tasks cannot be ticked, the click is undone.
 */
function onPreviewClick(event: MouseEvent) {
	const preview = previewRef.value
	const target = event.target
	if (!preview || !(target instanceof HTMLInputElement) || !target.matches(TASK_BOX)) return
	if (!props.canToggleTasks) {
		event.preventDefault()
		return
	}
	const index = [...preview.querySelectorAll(TASK_BOX)].indexOf(target)
	if (index >= 0) emit('toggleTask', index, target.checked)
}

/** Fade the last line when preview content is taller than the widget. */
function updateClip() {
	if (props.isEditing) {
		isClipped.value = false
		return
	}
	const el = previewRef.value
	if (!el) {
		isClipped.value = false
		return
	}
	isClipped.value = el.scrollHeight - el.clientHeight - el.scrollTop > 1
}

async function scheduleClipUpdate() {
	await nextTick()
	updateClip()
	const el = previewRef.value
	if (!el) return
	for (const img of el.querySelectorAll('img')) {
		if (!img.complete) img.addEventListener('load', updateClip, { once: true })
	}
}

useResizeObserver(previewRef, updateClip)

function isTouchUi(): boolean {
	if (typeof window === 'undefined') return false
	return (
		navigator.maxTouchPoints > 0
		|| window.matchMedia('(pointer: coarse)').matches
	)
}

function isSoftKeyboardOpen(): boolean {
	const vv = window.visualViewport
	if (!vv) return false
	return window.innerHeight - vv.height > KEYBOARD_VIEWPORT_GAP
}

let stopKeyboardDismissWatch: (() => void) | null = null

function clearKeyboardDismissWatch() {
	stopKeyboardDismissWatch?.()
	stopKeyboardDismissWatch = null
}

/**
 * Phone keyboard-dismiss often leaves the textarea focused (edit shadow stays).
 * Watch visualViewport: once the keyboard was open and then closes, exit edit.
 */
function watchKeyboardDismissWhileEditing() {
	clearKeyboardDismissWatch()
	if (!isTouchUi()) return
	const vv = window.visualViewport
	if (!vv) return

	let sawKeyboardOpen = isSoftKeyboardOpen()
	let closeTimer: ReturnType<typeof setTimeout> | null = null

	const clearCloseTimer = () => {
		if (closeTimer !== null) {
			clearTimeout(closeTimer)
			closeTimer = null
		}
	}

	const onViewportResize = () => {
		if (!props.isEditing) return
		if (isSoftKeyboardOpen()) {
			sawKeyboardOpen = true
			clearCloseTimer()
			return
		}
		// Still settling after create-note proxy→textarea handoff.
		if (shouldIgnoreNoteKeyboardDismiss()) {
			clearCloseTimer()
			return
		}
		if (!sawKeyboardOpen) return

		clearCloseTimer()
		closeTimer = setTimeout(() => {
			closeTimer = null
			if (!props.isEditing) return
			if (shouldIgnoreNoteKeyboardDismiss()) return
			if (isSoftKeyboardOpen()) return
			// Dismiss save+exit even when the textarea keeps DOM focus.
			emit('blur')
		}, KEYBOARD_CLOSE_DEBOUNCE_MS)
	}

	vv.addEventListener('resize', onViewportResize)
	stopKeyboardDismissWatch = () => {
		clearCloseTimer()
		vv.removeEventListener('resize', onViewportResize)
	}
}

/** A canvas node stays `visibility: hidden` until Vue Flow has measured it: this many frames at most. */
const FOCUS_RETRY_FRAMES = 30

async function focusEditing() {
	window.getSelection()?.removeAllRanges()
	await nextTick()
	const point = takeEditPoint()
	let placed = false
	// The editor may still be loading, and a block created and opened in one
	// go (the canvas, right after a click) can be asked for focus before Vue
	// Flow made its node visible: a hidden element cannot take focus, and the
	// block would be open but not typeable. Keep asking, frame by frame, while
	// it is still being edited.
	for (let frame = 0; frame <= FOCUS_RETRY_FRAMES; frame++) {
		if (frame > 0) await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
		if (!props.isEditing) return
		const current = editingElement()
		if (!current) continue
		if (!placed) {
			placed = true
			editorRef.value?.placeCaret(point)
			autosizeStackTextarea()
		}
		const active = document.activeElement
		if (active === current) return
		// Focus went into another field (the user moved on): leave it there.
		if (
			frame > 0
			&& active instanceof HTMLElement
			&& !current.contains(active)
			&& (active.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active.tagName))
			&& !active.hasAttribute('aria-hidden')
		) return
		// Prefer transfer when create-note armed a touch keyboard proxy.
		transferNoteKeyboardFocus(current)
		if (document.activeElement === current) return
	}
}

/** `.txt` in a textarea: Esc leaves editing, as in the rich editor. */
function onTextareaKeydown(event: KeyboardEvent) {
	if (event.key !== 'Escape') return
	event.preventDefault()
	emit('blur')
}

/** Stack notes grow with content up to max-height instead of staying a fixed box. */
function autosizeStackTextarea() {
	if (!growsWithText.value) return
	const textarea = textareaRef.value
	if (!textarea) return
	textarea.style.height = 'auto'
	textarea.style.height = `${textarea.scrollHeight}px`
}

/**
 * Drag-selecting text can blur the textarea (WebKit + `user-select:none`
 * ancestors; pointer leaving the field). WKWebView also skips pointerevents
 * on form controls, so track the gesture via mousedown as well.
 *
 * Keep the gesture flag through the following animation frame so a blur rAF
 * scheduled before pointerup still sees it.
 */
let textareaSelectGesture = false
let endingTextareaSelectGesture = false

function clearTextareaSelectGestureListeners() {
	window.removeEventListener('pointerup', onTextareaSelectGestureEnd, true)
	window.removeEventListener('pointercancel', onTextareaSelectGestureEnd, true)
	window.removeEventListener('mouseup', onTextareaSelectGestureEnd, true)
}

function onTextareaSelectGestureStart(event: MouseEvent | PointerEvent) {
	if ('button' in event && event.button !== 0) return
	if (textareaSelectGesture) return
	textareaSelectGesture = true
	endingTextareaSelectGesture = false
	window.addEventListener('pointerup', onTextareaSelectGestureEnd, true)
	window.addEventListener('pointercancel', onTextareaSelectGestureEnd, true)
	window.addEventListener('mouseup', onTextareaSelectGestureEnd, true)
}

function restoreTextareaAfterSelectGesture() {
	const current = editingElement()
	if (!current || !props.isEditing) return
	if (current.contains(document.activeElement)) return
	if (current instanceof HTMLTextAreaElement) {
		const start = current.selectionStart
		const end = current.selectionEnd
		transferNoteKeyboardFocus(current)
		current.setSelectionRange(start, end)
		return
	}
	// ProseMirror puts its own selection back on focus.
	transferNoteKeyboardFocus(current)
}

function onTextareaSelectGestureEnd() {
	if (!textareaSelectGesture || endingTextareaSelectGesture) return
	endingTextareaSelectGesture = true
	clearTextareaSelectGestureListeners()
	requestAnimationFrame(() => {
		textareaSelectGesture = false
		endingTextareaSelectGesture = false
		restoreTextareaAfterSelectGesture()
	})
}

/**
 * Blur exits edit, except:
 * - transient unmount (stack/masonry re-init)
 * - focus still inside the editor (a task box in it)
 * - focus stolen by folder chrome / dropdown (create-from-menu)
 * - drag-selecting text (WebKit blurs the field while the button is down)
 */
function onEditingBlur() {
	requestAnimationFrame(() => {
		const current = editingElement()
		if (!current || !props.isEditing) return
		if (current.contains(document.activeElement)) return
		if (textareaSelectGesture) return

		const active = document.activeElement
		if (
			active instanceof Element
			&& active.closest('.folder-chrome, [role="menu"], [data-reka-popper-content-wrapper]')
		) {
			transferNoteKeyboardFocus(current)
			return
		}

		emit('blur')
	})
}

watch(text, async () => {
	if (!props.isEditing || !growsWithText.value) return
	await nextTick()
	autosizeStackTextarea()
})

watch(() => [props.previewHtml, text.value, props.isEditing], () => {
	void scheduleClipUpdate()
})

watch(() => props.isEditing, async (editing) => {
	if (editing) {
		watchKeyboardDismissWhileEditing()
		await focusEditing()
	} else {
		clearKeyboardDismissWatch()
	}
})

onMounted(async () => {
	if (props.isEditing) {
		watchKeyboardDismissWhileEditing()
		await focusEditing()
	} else {
		await scheduleClipUpdate()
	}
})

onUnmounted(() => {
	clearKeyboardDismissWatch()
	clearTextareaSelectGestureListeners()
	textareaSelectGesture = false
	endingTextareaSelectGesture = false
})
</script>

<template>
	<div
		v-if="!isEditing && isMarkdown"
		ref="preview"
		class="note-preview note-content prose prose-sm prose-gray max-w-none"
		:class="{
			'note-preview--stack': variant === 'stack',
			'note-preview--text': isTextAppearance,
			'note-preview--text-auto': isTextAppearance && !fixedWidth,
			'note-preview--fade': isClipped && !isTextAppearance,
			'note-preview--tasks-locked': !canToggleTasks,
		}"
		v-html="previewHtml"
		@click="onPreviewClick"
		@scroll.passive="updateClip"
	/>
	<div
		v-else-if="!isEditing"
		ref="preview"
		class="note-preview note-preview--plain"
		:class="{
			'note-preview--stack': variant === 'stack',
			'note-preview--text': isTextAppearance,
			'note-preview--text-auto': isTextAppearance && !fixedWidth,
			'note-preview--fade': isClipped && !isTextAppearance,
		}"
		@scroll.passive="updateClip"
	>{{ text }}</div>
	<NoteRichEditor
		v-else-if="richEditing"
		ref="editor"
		v-model="text"
		class="note-editing note-content prose prose-sm prose-gray max-w-none"
		:class="{
			'note-editing--stack': variant === 'stack',
			'note-editing--text': isTextAppearance,
			'note-editing--text-auto': isTextAppearance && !fixedWidth,
			nodrag: canvasMode,
			nopan: canvasMode,
		}"
		@escape="emit('blur')"
		@focusout="onEditingBlur"
		@pointerdown="onTextareaSelectGestureStart"
		@mousedown="onTextareaSelectGestureStart"
		@dblclick.stop
	/>
	<!--
		Text block: the textarea sits in one grid cell with a hidden copy of its
		own text (::after). The copy sizes the cell, so the box grows with the
		text in height, and in width too until the width is fixed. No script.
		The trailing space makes a final line break take a line.
	-->
	<div
		v-else-if="isTextAppearance"
		class="note-grow"
		:class="{ 'note-grow--auto': !fixedWidth }"
		:data-replicated="`${text} `"
	>
		<textarea
			ref="textarea"
			v-model="text"
			class="note-textarea note-textarea--text"
			:class="{
				nodrag: canvasMode,
				nopan: canvasMode,
			}"
			rows="1"
			:wrap="fixedWidth ? 'soft' : 'off'"
			@keydown="onTextareaKeydown"
			@pointerdown="onTextareaSelectGestureStart"
			@mousedown="onTextareaSelectGestureStart"
			@blur="onEditingBlur"
			@dblclick.stop
		/>
	</div>
	<textarea
		v-else
		ref="textarea"
		v-model="text"
		class="note-textarea"
		:class="{
			'note-textarea--stack': variant === 'stack',
			nodrag: canvasMode,
			nopan: canvasMode,
		}"
		@input="autosizeStackTextarea"
		@keydown="onTextareaKeydown"
		@pointerdown="onTextareaSelectGestureStart"
		@mousedown="onTextareaSelectGestureStart"
		@blur="onEditingBlur"
		@dblclick.stop
	/>
</template>

<style scoped>
/* What the preview and the rich editor share: the note's typography, so
   nothing moves when editing starts. */
.note-content {
	--tw-prose-body: rgb(23 23 23);
	--tw-prose-headings: rgb(23 23 23);
	--tw-prose-bold: rgb(23 23 23);
	--tw-prose-counters: rgb(82 82 82);
	--tw-prose-bullets: rgb(163 163 163);
	--tw-prose-links: rgb(37 99 235);
	--tw-prose-code: rgb(23 23 23);
	/* prose paints code blocks dark for light text, but the rule below makes
	   pre/code inherit the dark note color — keep the block light instead;
	   translucent so it works on any note background */
	--tw-prose-pre-code: rgb(23 23 23);
	--tw-prose-pre-bg: rgb(0 0 0 / 0.06);
	color: rgb(23 23 23);
}

.note-preview {
	height: 100%;
	overflow: auto;
	touch-action: none;
	overscroll-behavior: none;
	user-select: none;
	-webkit-user-select: none;
}

/* Editing: the same box as the preview, scrolled rather than faded. */
.note-editing {
	height: 100%;
	overflow: auto;
	cursor: text;
	user-select: text;
	-webkit-user-select: text;
	touch-action: auto;
}

.note-editing :deep(.ProseMirror) {
	min-height: 100%;
	outline: none;
	overflow-wrap: break-word;
}

/* prose drops the outer margins of its own first and last child; here the
   blocks sit two levels deeper, inside Tiptap's element: same rule, or the
   text would move down by a line's margin when editing starts. */
.note-editing :deep(.ProseMirror > :first-child) {
	margin-top: 0;
}

.note-editing :deep(.ProseMirror > :last-child) {
	margin-bottom: 0;
}

.note-editing--stack {
	height: auto;
	min-height: 4rem;
	max-height: 24rem;
}

/* A raw block (HTML the note keeps as written) is one piece: it shows it is selected. */
.note-editing :deep(.ProseMirror-selectednode) {
	outline: 2px solid rgb(37 99 235 / 0.35);
	outline-offset: 2px;
	border-radius: 4px;
}

.note-editing--text {
	height: auto;
	overflow: visible;
}

/* A text block grows to the right until its width is fixed: a line breaks
   only at Enter. */
.note-editing--text-auto {
	width: max-content;
	min-width: 1.5em;
}

.note-editing--text-auto :deep(.ProseMirror) {
	white-space: pre;
	overflow-wrap: normal;
}

.note-editing--text:not(.note-editing--text-auto) :deep(.ProseMirror) {
	overflow-wrap: anywhere;
}

.note-preview--fade {
	-webkit-mask-image: linear-gradient(
		to bottom,
		#000 calc(100% - min(2.25rem, 40%)),
		transparent
	);
	mask-image: linear-gradient(
		to bottom,
		#000 calc(100% - min(2.25rem, 40%)),
		transparent
	);
}

.note-preview--plain {
	white-space: pre-wrap;
	word-break: break-word;
	font-size: 14px;
}

.note-preview--stack {
	width: 100%;
	min-height: 1.5rem;
	max-height: 24rem;
	height: auto;
}

/* A text block's box follows its text, so the preview is never cut or
   scrolled. (`prose` already drops the top margin of the first child and the
   bottom margin of the last, so a heading starts on the box's top edge like
   the raw text did in the textarea.) */
.note-preview--text {
	height: auto;
	overflow: visible;
}

/* Until the width is fixed a line breaks only where the text does (Enter,
   or <br> in the rendered text), and the box is as wide as its longest line. */
.note-preview--text-auto {
	width: max-content;
	white-space: nowrap;
}
.note-preview--text-auto.note-preview--plain {
	white-space: pre;
}
.note-preview--text:not(.note-preview--text-auto) {
	overflow-wrap: anywhere;
}

.note-content :deep(:where(p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, aside, strong, em, code, pre)) {
	color: inherit;
}

/* Typography draws literal backticks around inline code and leaves it bare,
   so `name` looks like raw markdown. A chip instead, same fill as a code block. */
.note-content :deep(:not(pre) > code) {
	background: rgb(0 0 0 / 0.08);
	border-radius: 0.375rem;
	padding: 0.15em 0.4em;
	font-family: var(--font-mono);
	font-size: 0.85em;
	font-weight: 500;
}

.note-content :deep(:not(pre) > code)::before,
.note-content :deep(:not(pre) > code)::after {
	content: none;
}

/* A callout (`> [!NOTE]`, and Notion's <aside>, which the old renderer still
   shows). Translucent so a colored note still shows through. */
.note-content :deep(:where(aside, div[data-callout])) {
	background: rgb(0 0 0 / 0.06);
	border-radius: 0.5rem;
	padding: 0.7rem 0.85rem;
	margin: 0.75rem 0;
}

.note-content :deep(:where(aside, div[data-callout]) > :first-child) {
	margin-top: 0;
}

.note-content :deep(:where(aside, div[data-callout]) > :last-child) {
	margin-bottom: 0;
}

/* The note schema wraps a list item's and a table cell's text in <p>, which
   marked did not for a tight list: no extra space, as before. */
.note-content :deep(li > p),
.note-content :deep(:where(td, th) > p) {
	margin-top: 0;
	margin-bottom: 0;
}

.note-content :deep(li > p + p) {
	margin-top: 0.5em;
}

/* A task: its box instead of the bullet. */
.note-content :deep(ul[data-type="taskList"]) {
	list-style: none;
	padding-inline-start: 0;
}

.note-content :deep(li[data-type="taskItem"]) {
	display: flex;
	gap: 0.5em;
	align-items: flex-start;
	padding-inline-start: 0;
}

.note-content :deep(li[data-type="taskItem"] > label) {
	flex: none;
	display: flex;
	align-items: center;
	height: 1.7142857em;
}

.note-content :deep(li[data-type="taskItem"] > label > input) {
	width: 13px;
	height: 13px;
	margin: 0;
	accent-color: rgb(82 82 82);
	cursor: pointer;
}

.note-preview--tasks-locked :deep(li[data-type="taskItem"] > label > input) {
	cursor: default;
}

.note-content :deep(li[data-type="taskItem"] > div) {
	flex: 1;
	min-width: 0;
}

.note-content :deep(li[data-type="taskItem"] > div > :first-child) {
	margin-top: 0;
}

.note-content :deep(li[data-type="taskItem"] > div > :last-child) {
	margin-bottom: 0;
}

/* The header row sits in <tbody> as <th> cells: padded like the body cells. */
.note-content :deep(tbody th) {
	padding: 0.6666667em 1em;
	font-weight: 600;
	text-align: start;
	vertical-align: bottom;
}

.note-content :deep(tbody th:first-child) {
	padding-inline-start: 0;
}

.note-content :deep(tbody th:last-child) {
	padding-inline-end: 0;
}

.note-content :deep(mark) {
	color: inherit;
	border-radius: 3px;
	padding: 0 0.1em;
}

.note-content :deep(small) {
	font-size: 0.85em;
}

/* Front matter shows as its source, quietly. */
.note-content :deep(pre[data-front-matter]) {
	font-size: 0.8em;
	opacity: 0.7;
}

.note-preview::selection {
	background: transparent;
}

.note-textarea {
	font-size: 14px;
	font-family: inherit;
	border: none;
	resize: none;
	width: 100%;
	height: 100%;
	outline: none;
	background-color: transparent;
	padding: 0;
	cursor: text;
	user-select: text !important;
	-webkit-user-select: text !important;
	touch-action: auto;
}

.note-textarea--stack {
	resize: none;
	height: auto;
	min-height: 4rem;
	max-height: 24rem;
	overflow-y: auto;
	field-sizing: content;
}

/* Text block, editing: textarea and a hidden copy of its text share one grid
   cell. Both must lay the text out the same way, so the font, the line height
   and the wrapping are set once for the pair. */
.note-grow {
	display: grid;
	min-width: 0;
	--note-grow-wrap: pre-wrap;
}
.note-grow--auto {
	/* the box is as wide as the longest line; an empty text still has a caret's width */
	width: max-content;
	min-width: 1.5em;
	--note-grow-wrap: pre;
}
.note-grow::after,
.note-grow > textarea {
	grid-area: 1 / 1 / 2 / 2;
	font-size: 14px;
	font-family: inherit;
	line-height: 1.5;
	letter-spacing: normal;
	white-space: var(--note-grow-wrap);
	overflow-wrap: anywhere;
	padding: 0;
	margin: 0;
	border: none;
	box-sizing: border-box;
}
.note-grow--auto::after,
.note-grow--auto > textarea {
	overflow-wrap: normal;
}
.note-grow::after {
	content: attr(data-replicated);
	visibility: hidden;
	pointer-events: none;
}
/* width 0 + min-width 100%: the textarea's own default width (20 columns) must
   not size the cell, only the hidden copy of the text does. */
.note-grow > textarea {
	width: 0;
	min-width: 100%;
	height: 100%;
	min-height: 0;
	align-self: stretch;
	justify-self: stretch;
	overflow: hidden;
}
</style>

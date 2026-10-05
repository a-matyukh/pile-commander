<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useIntersectionObserver, useResizeObserver } from '@vueuse/core'
import {
	shouldIgnoreNoteKeyboardDismiss,
	transferNoteKeyboardFocus,
} from '../noteKeyboardFocus'
import { wrapMarkdownSelection } from './wrapMarkdownSelection'

const props = withDefaults(defineProps<{
	isEditing: boolean
	previewHtml: string
	isMarkdown?: boolean
	canvasMode?: boolean
	variant?: 'fill' | 'stack'
}>(), {
	isMarkdown: true,
	canvasMode: false,
	variant: 'fill',
})

const text = defineModel<string>({ required: true })

const emit = defineEmits<{
	blur: []
	visible: []
}>()

const textareaRef = useTemplateRef<HTMLTextAreaElement>('textarea')
const previewRef = useTemplateRef<HTMLDivElement>('preview')
const isClipped = ref(false)
const { macOS } = useKbd()

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

async function focusTextarea() {
	window.getSelection()?.removeAllRanges()
	await nextTick()
	const textarea = textareaRef.value
	if (!textarea) return
	// Prefer transfer when create-note armed a touch keyboard proxy.
	transferNoteKeyboardFocus(textarea)
	autosizeStackTextarea()
}

function isFormatModifier(event: KeyboardEvent): boolean {
	if (event.shiftKey || event.ctrlKey) return false
	if (macOS.value) return event.metaKey && !event.altKey
	return event.altKey && !event.metaKey
}

function formatMarkerForKey(event: KeyboardEvent): string | null {
	if (event.code === 'KeyB' || event.key.toLowerCase() === 'b') return '**'
	if (event.code === 'KeyI' || event.key.toLowerCase() === 'i') return '*'
	return null
}

function onTextareaKeydown(event: KeyboardEvent) {
	if (!isFormatModifier(event)) return
	const marker = formatMarkerForKey(event)
	if (!marker) return
	const textarea = textareaRef.value
	if (!textarea) return
	event.preventDefault()
	const result = wrapMarkdownSelection(
		textarea.value,
		textarea.selectionStart,
		textarea.selectionEnd,
		marker,
	)
	textarea.setRangeText(result.text, 0, textarea.value.length, 'end')
	textarea.dispatchEvent(new Event('input', { bubbles: true }))
	textarea.setSelectionRange(result.selectionStart, result.selectionEnd)
}

/** Stack notes grow with content up to max-height instead of staying a fixed box. */
function autosizeStackTextarea() {
	if (props.variant !== 'stack') return
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
	const textarea = textareaRef.value
	if (!textarea || !props.isEditing) return
	if (document.activeElement === textarea) return
	const start = textarea.selectionStart
	const end = textarea.selectionEnd
	transferNoteKeyboardFocus(textarea)
	if (start != null && end != null) {
		textarea.setSelectionRange(start, end)
	}
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
 * - focus stolen by folder chrome / dropdown (create-from-menu)
 * - drag-selecting text (WebKit blurs the field while the button is down)
 */
function onTextareaBlur() {
	requestAnimationFrame(() => {
		if (!textareaRef.value || !props.isEditing) return
		if (document.activeElement === textareaRef.value) return
		if (textareaSelectGesture) return

		const active = document.activeElement
		if (
			active instanceof Element
			&& active.closest('.folder-chrome, [role="menu"], [data-reka-popper-content-wrapper]')
		) {
			transferNoteKeyboardFocus(textareaRef.value)
			return
		}

		emit('blur')
	})
}

watch(text, async () => {
	if (!props.isEditing || props.variant !== 'stack') return
	await nextTick()
	autosizeStackTextarea()
})

watch(() => [props.previewHtml, text.value, props.isEditing], () => {
	void scheduleClipUpdate()
})

watch(() => props.isEditing, async (editing) => {
	if (editing) {
		watchKeyboardDismissWhileEditing()
		await focusTextarea()
	} else {
		clearKeyboardDismissWatch()
	}
})

onMounted(async () => {
	if (props.isEditing) {
		watchKeyboardDismissWhileEditing()
		await focusTextarea()
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
		class="note-preview prose prose-sm prose-gray max-w-none"
		:class="{
			'note-preview--stack': variant === 'stack',
			'note-preview--fade': isClipped,
		}"
		v-html="previewHtml"
		@scroll.passive="updateClip"
	/>
	<div
		v-else-if="!isEditing"
		ref="preview"
		class="note-preview note-preview--plain"
		:class="{
			'note-preview--stack': variant === 'stack',
			'note-preview--fade': isClipped,
		}"
		@scroll.passive="updateClip"
	>{{ text }}</div>
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
		@blur="onTextareaBlur"
		@dblclick.stop
	/>
</template>

<style scoped>
.note-preview {
	height: 100%;
	overflow: auto;
	touch-action: none;
	overscroll-behavior: none;
	user-select: none;
	-webkit-user-select: none;
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

.note-preview :deep(:where(p, h1, h2, h3, h4, h5, h6, li, td, th, blockquote, strong, em, code, pre)) {
	color: inherit;
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
</style>

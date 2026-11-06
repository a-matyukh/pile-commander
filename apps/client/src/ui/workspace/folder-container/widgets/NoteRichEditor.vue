<script setup lang="ts">
/**
 * A note or text block (`.md`) edited as rendered text: Tiptap over the
 * note schema of services/text, the same one the preview renders with, so
 * nothing moves when editing starts. Loaded lazily (NoteBody), with the
 * note renderer's chunk.
 *
 * The text only changes when the document does: a document that serializes
 * to what it was opened with hands back the original text, byte for byte,
 * so opening and closing a note never rewrites its file.
 */
import { onBeforeUnmount, useTemplateRef } from 'vue'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state'
import { NoteEditing } from '@/services/text/editing'
import { note_extensions, type Align } from '@/services/text/extensions'
import { note_markdown } from '@/services/text/markdown'
import { raw_html } from '@/services/text/render'
import FormatBubble from './FormatBubble.vue'

const props = withDefaults(defineProps<{
	/** Shapes centre their text (stage 4); notes and text blocks are left-aligned. */
	defaultAlign?: Align
}>(), {
	defaultAlign: 'left',
})

const text = defineModel<string>({ required: true })

const emit = defineEmits<{
	escape: []
	/** Focus left the formatting popup for something outside the note. */
	leave: []
}>()

const bubble = useTemplateRef<InstanceType<typeof FormatBubble>>('bubble')

const reader = note_markdown(props.defaultAlign)
const original = text.value
/** What the opened document writes as: equal again means nothing changed. */
let baseline: string | null = null

const editor = new Editor({
	extensions: [
		...note_extensions({ default_align: props.defaultAlign, raw_html }),
		NoteEditing.configure({
			on_escape: () => emit('escape'),
			on_link: () => void bubble.value?.openLink(),
		}),
	],
	content: reader.parse(original),
	editorProps: {
		attributes: { class: 'note-editor', spellcheck: 'true' },
	},
	onUpdate: ({ editor: current }) => {
		// A plugin may adjust the document while it is set up: that is not an edit.
		if (baseline === null) return
		const markdown = reader.serialize(current.getJSON())
		text.value = markdown === baseline ? original : markdown
	},
})

baseline = reader.serialize(editor.getJSON())

onBeforeUnmount(() => {
	editor.destroy()
})

/** The element that takes focus (and the soft keyboard). */
function element(): HTMLElement | null {
	return editor.isDestroyed ? null : editor.view.dom
}

/**
 * Puts the caret where the opening gesture landed, or at the end. Call
 * before focusing: ProseMirror shows its own selection on focus.
 */
function placeCaret(point: { x: number; y: number } | null) {
	if (editor.isDestroyed) return
	const { view, state } = editor
	const at = point ? view.posAtCoords({ left: point.x, top: point.y }) : null
	const selection = at
		? TextSelection.near(state.doc.resolve(at.pos))
		: Selection.atEnd(state.doc)
	view.dispatch(state.tr.setSelection(selection))
}

defineExpose({ element, placeCaret })

/**
 * The popup lives in the Explorer's root, not in the note: a note clips what
 * leaves its box, and the canvas would scale it with the zoom. On a touch
 * screen it sits under the selection, out of the system's own menu.
 */
const bubbleTarget = () => document.querySelector<HTMLElement>('.explorer') ?? document.body
const touch = typeof window !== 'undefined'
	&& (navigator.maxTouchPoints > 0 || window.matchMedia('(pointer: coarse)').matches)
const bubbleOptions = {
	strategy: 'fixed' as const,
	placement: touch ? 'bottom' as const : 'top' as const,
	offset: 8,
	flip: { padding: 8 },
	shift: { padding: 8 },
}

/** Text is selected: a selected raw block or line has nothing to format. */
function bubbleShouldShow({ editor: current, state, from, to }: { editor: { isEditable: boolean; view: { hasFocus(): boolean } }; state: typeof editor.state; from: number; to: number }) {
	if (!current.isEditable || from === to || state.selection instanceof NodeSelection) return false
	if (!state.doc.textBetween(from, to).length) return false
	const popup = bubble.value?.$el as HTMLElement | undefined
	return current.view.hasFocus() || !!popup?.contains(document.activeElement)
}
</script>

<template>
	<div>
		<!-- One root, so NoteBody's classes, scoped styles and listeners reach the text. -->
		<EditorContent class="note-editor-content" :editor="editor" />
		<BubbleMenu
			:editor="editor"
			:append-to="bubbleTarget"
			:options="bubbleOptions"
			:should-show="bubbleShouldShow"
			:update-delay="120"
		>
			<FormatBubble ref="bubble" :editor="editor" :default-align="defaultAlign" @leave="emit('leave')" />
		</BubbleMenu>
	</div>
</template>

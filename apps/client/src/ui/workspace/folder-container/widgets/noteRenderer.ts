import type { Align } from '@/services/text/extensions'
import { parseNoteMarkdown } from './markdown'

/** `align`: the alignment the text has unless it says otherwise (a shape centres its text). */
export type NoteRender = (markdown: string, align?: Align) => string

let loaded: NoteRender | null = null
let loading: Promise<NoteRender> | null = null

/**
 * The note renderer (services/text: Tiptap, ProseMirror, marked) is a chunk
 * of its own, loaded with the first note. A note whose chunk cannot load (a
 * web build replaced by a deploy, offline) still shows, the old way, and the
 * next note tries again.
 */
export function loadNoteRenderer(): Promise<NoteRender> {
	if (loaded) return Promise.resolve(loaded)
	loading ??= import('@/services/text/render')
		.then((module) => {
			loaded = (markdown: string, align: Align = 'left') => module.render_note_html(markdown, align)
			return loaded
		})
		.catch((error: unknown) => {
			console.warn('[notes] the note renderer did not load', error)
			loading = null
			return parseNoteMarkdown
		})
	return loading
}

let editorLoading: Promise<typeof import('./NoteRichEditor.vue')> | null = null

/**
 * The note editor (Tiptap's Vue binding over the same schema): its own small
 * chunk, next to the renderer's. A failed load is tried again next time.
 */
export function loadNoteEditor(): Promise<typeof import('./NoteRichEditor.vue')> {
	editorLoading ??= import('./NoteRichEditor.vue').catch((error: unknown) => {
		editorLoading = null
		throw error
	})
	return editorLoading
}

/** The renderer once loaded; null before. */
export function loadedNoteRenderer(): NoteRender | null {
	return loaded
}

/** A task's checkbox in a rendered note, in the order toggle_task counts tasks. */
export const TASK_BOX = 'li[data-type="taskItem"] > label > input[type="checkbox"]'

/** The task box (or its label) an event hit, if any. */
export function taskBoxLabel(target: EventTarget | null): Element | null {
	return target instanceof Element ? target.closest('li[data-type="taskItem"] > label') : null
}

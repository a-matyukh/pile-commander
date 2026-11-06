import { parseNoteMarkdown } from './markdown'

export type NoteRender = (markdown: string) => string

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
			loaded = (markdown: string) => module.render_note_html(markdown)
			return loaded
		})
		.catch((error: unknown) => {
			console.warn('[notes] the note renderer did not load', error)
			loading = null
			return parseNoteMarkdown
		})
	return loading
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

import { inject, provide, ref, watch, type InjectionKey, type Ref } from 'vue'

type NoteExitHandler = () => void | Promise<void>

export type EditingNoteState = {
	editingNoteId: Ref<string | null>
	/** Registers a callback fired when the given note stops being edited. Returns an unregister fn. */
	onNoteEditExit: (widgetId: string, handler: NoteExitHandler) => () => void
}

const editingNoteIdKey: InjectionKey<EditingNoteState> = Symbol('editingNoteId')

function createEditingNoteState(editingNoteId: Ref<string | null>): EditingNoteState {
	const exitHandlers = new Map<string, NoteExitHandler>()

	// Single watcher per view (instead of one per note widget).
	watch(editingNoteId, (newId, oldId) => {
		if (oldId && oldId !== newId) {
			void exitHandlers.get(oldId)?.()
		}
	})

	function onNoteEditExit(widgetId: string, handler: NoteExitHandler) {
		exitHandlers.set(widgetId, handler)
		return () => {
			if (exitHandlers.get(widgetId) === handler) {
				exitHandlers.delete(widgetId)
			}
		}
	}

	return { editingNoteId, onNoteEditExit }
}

export function provideEditingNoteId(editingNoteId: Ref<string | null>) {
	provide(editingNoteIdKey, createEditingNoteState(editingNoteId))
}

export function useEditingNoteId(options?: {
	/** Skip the missing-provider warning (e.g. chrome menus that use the pane registry). */
	optional?: boolean
}): EditingNoteState {
	const injected = inject(editingNoteIdKey, null)
	if (injected) {
		return injected
	}
	// Orphan state: editing won't sync with the hosting view.
	// Every view that renders notes must call provideEditingNoteId.
	if (import.meta.env.DEV && !options?.optional) {
		console.warn('[useEditingNoteId] no provider found; falling back to a local ref. Call provideEditingNoteId in the hosting view.')
	}
	return createEditingNoteState(ref<string | null>(null))
}

import type { Position } from '@/domain/Widget'
import { blockMenuClickThrough } from './board/blockGhostClick'
import { armNoteKeyboardFocus } from './noteKeyboardFocus'

export type PanePositionResolver = (
	clientX: number,
	clientY: number,
) => Position | null

type PaneEditingNoteSetter = (noteId: string | null) => void

const positionResolvers = new Map<string, PanePositionResolver>()
const editingNoteSetters = new Map<string, PaneEditingNoteSetter>()

/** Board/Canvas register how to map client coords → pane widget position. */
export function registerPanePositionResolver(
	folderId: string,
	resolver: PanePositionResolver | null,
): void {
	if (resolver) {
		positionResolvers.set(folderId, resolver)
	} else {
		positionResolvers.delete(folderId)
	}
}

/** Board/Canvas register their editing-note ref for create-from-chrome. */
export function registerPaneEditingNoteSetter(
	folderId: string,
	setter: PaneEditingNoteSetter | null,
): void {
	if (setter) {
		editingNoteSetters.set(folderId, setter)
	} else {
		editingNoteSetters.delete(folderId)
	}
}

export function setRegisteredEditingNoteId(
	folderId: string,
	noteId: string | null,
): void {
	editingNoteSetters.get(folderId)?.(noteId)
}

/** Call at the start of a menu create-note action, before awaiting I/O. */
export function armNoteCreateFromMenu(): void {
	blockMenuClickThrough()
	// Sync with the select gesture so touch devices can open the soft keyboard.
	armNoteKeyboardFocus()
}

/**
 * Enter note edit after a menu `onSelect`.
 * Prefer calling {@link armNoteCreateFromMenu} before the async create so the
 * menu click-through is blocked and the soft-keyboard proxy stays focused
 * while create_note runs. Set editing immediately so the real textarea can
 * take over before the keyboard session drops.
 */
export function beginRegisteredNoteEditing(
	folderId: string,
	noteId: string,
): void {
	setRegisteredEditingNoteId(folderId, noteId)
}

/** Maps client coords into the pane of `folderId`; null when it is unmounted. */
export function resolvePanePosition(
	folderId: string,
	clientX: number,
	clientY: number,
): Position | null {
	return positionResolvers.get(folderId)?.(clientX, clientY) ?? null
}

/** Client center of the folder pane section, mapped into pane coordinates. */
export function resolvePaneCenterPosition(folderId: string): Position | null {
	const sections = document.querySelectorAll<HTMLElement>(
		`section[data-path="${CSS.escape(folderId)}"]`,
	)
	// Prefer the innermost section (board/canvas pane over preview chrome wrappers).
	const section = sections[sections.length - 1]
	if (!section) return null

	const rect = section.getBoundingClientRect()
	const clientX = rect.left + rect.width / 2
	const clientY = rect.top + rect.height / 2

	return positionResolvers.get(folderId)?.(clientX, clientY) ?? null
}

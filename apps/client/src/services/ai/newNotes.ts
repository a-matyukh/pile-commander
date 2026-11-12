import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild, Position } from '@/domain/Widget'
import { board_size, NOTE_DEFAULT_SIZE } from '@/services/board/layout'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import type { HistoryTx } from '@/store/history/types'
import { strip_think, untrusted_markdown } from './text'

/**
 * New notes an AI proposes, from an agent or from the app's own model: their
 * names, where they go on a board, and the write once the person confirms.
 */

const NOTE_GAP = 24
/** Notes per row when several are placed together. */
const NOTES_PER_ROW = 3

/**
 * A file name that already ends in another extension (`.txt`, `.csv`) is not
 * a note. A leading dot is the hidden-name mark, not an extension.
 */
const OTHER_EXTENSION = /^.+\.[A-Za-z][A-Za-z0-9]{0,7}$/

/**
 * The note's file name: `.md` is kept, added when there is no extension.
 * Null for another extension: a note is Markdown.
 */
export function note_file_name(name: string): string | null {
	const trimmed = name.trim()
	if (/\.md$/i.test(trimmed)) return trimmed
	if (OTHER_EXTENSION.test(trimmed)) return null
	return `${trimmed}.md`
}

/** Names as they will be written: a taken one, or one repeated in the batch, gets ` (1)`. */
export function planned_note_names(names: readonly string[], siblings: Iterable<string>): string[] {
	const taken = [...siblings]
	return names.map((name) => {
		const unique = resolve_unique_filename(name, taken, { ignore_case: true })
		taken.push(unique)
		return unique
	})
}

/**
 * Where `count` new notes go on a board, in rows of three: from `anchor`
 * when there is one (a click on the board), otherwise to the right of what
 * the folder holds, level with its topmost item. All null when nothing in
 * the folder has a board position (a list, a gallery): the folder places them.
 */
export function new_note_positions(
	children: readonly FolderContainerWidgetChild[],
	count: number,
	anchor: Position | null = null,
): (Position | null)[] {
	let start = anchor
	if (!start) {
		const placed = children.filter((child): child is FolderContainerWidgetChild & { position: Position } => !!child.position)
		if (!placed.length) return Array.from({ length: count }, () => null)
		const right = Math.max(...placed.map(child => child.position.x + board_size(child).width))
		const top = Math.min(...placed.map(child => child.position.y))
		start = { x: right + NOTE_GAP, y: top }
	}
	const origin = start
	return Array.from({ length: count }, (_, index) => ({
		x: origin.x + (index % NOTES_PER_ROW) * (NOTE_DEFAULT_SIZE.width + NOTE_GAP),
		y: origin.y + Math.floor(index / NOTES_PER_ROW) * (NOTE_DEFAULT_SIZE.height + NOTE_GAP),
	}))
}

export type NewNote = {
	/** Ends in `.md`. Numbered again if it was taken in the meantime. */
	name: string
	/** Markdown. Untrusted: reasoning is dropped, HTML escaped, images become their alt text. */
	text: string
	position: Position | null
}

export type NewNoteOutcome = {
	/** The note's id once it exists. */
	id?: string
	/** Its name on disk. A failed rename leaves it as `Note N.md`. */
	written_name?: string
	error?: string
}

type NoteWrites = Pick<WorkspaceStore, 'create_note' | 'save_note_content' | 'resolve_folder_data' | 'rename' | 'content_caches'>

/**
 * Writes the notes: all are created where asked, then filled, then named.
 * Every note is created before any is renamed, so each keeps a "Note N" id
 * of its own within the one record: one created and renamed before the next
 * would leave "Note 1.md" free, and every note would be born under that id.
 * With `tx` the whole batch is one undo, which removes the notes for good
 * while no one has touched them.
 */
export async function add_new_notes(
	workspace: NoteWrites,
	folder_id: string,
	notes: readonly NewNote[],
	tx?: HistoryTx,
): Promise<NewNoteOutcome[]> {
	const outcomes: NewNoteOutcome[] = notes.map(() => ({}))
	const ids: (string | null)[] = []
	for (const [index, note] of notes.entries()) {
		try {
			const id = await workspace.create_note(folder_id, note.position ?? undefined, { tx })
			if (!id) outcomes[index] = { error: 'The note could not be created' }
			ids.push(id || null)
		} catch (error) {
			outcomes[index] = { error: message_of(error) }
			ids.push(null)
		}
	}
	for (const [index, note] of notes.entries()) {
		const id = ids[index]
		if (!id) continue
		try {
			await workspace.save_note_content(id, `${untrusted_markdown(strip_think(note.text)).trim()}\n`, { tx, before: '' })
		} catch (error) {
			outcomes[index] = { id, error: message_of(error) }
			ids[index] = null
			continue
		}
		// The new note's card holds the empty text it was born with: it reads the note again
		workspace.content_caches.notes.invalidate(id)
	}
	for (const [index, note] of notes.entries()) {
		const id = ids[index]
		if (!id) continue
		outcomes[index] = await name_note(workspace, folder_id, id, note.name, tx)
	}
	return outcomes
}

async function name_note(workspace: NoteWrites, folder_id: string, note_id: string, name: string, tx?: HistoryTx): Promise<NewNoteOutcome> {
	const children = workspace.resolve_folder_data(folder_id)?.children ?? []
	const born = children.find(child => child.id === note_id)?.name
	const siblings = children.filter(child => child.id !== note_id).map(child => child.name)
	const wanted = resolve_unique_filename(name, siblings, { ignore_case: true })
	try {
		const id = (await workspace.rename(note_id, wanted, { report: false, tx })) ?? note_id
		return { id, written_name: wanted }
	} catch {
		// the text is saved; the note keeps its "Note N.md" name
		return { id: note_id, written_name: born }
	}
}

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

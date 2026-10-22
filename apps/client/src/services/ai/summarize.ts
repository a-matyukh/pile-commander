import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import { get_media_kind } from '@/services/board/media'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import { image_to_data_url } from './imageInput'
import { is_note_name } from './naming'
import type { NameSources } from './suggestName'
import { strip_think, untrusted_markdown } from './text'
import type { AiContentPart, AiMessage } from './types'

/** Images in one summary request, the first ones on the board. */
export const MAX_SUMMARY_IMAGES = 12
/** Characters of note text in one summary request, shared across the notes. */
export const SUMMARY_TEXT_LIMIT = 24_000
/** A note cut to fit keeps at least this much, or is left out. */
const MIN_NOTE_PART = 400

/**
 * How much of the next note to send. The budget is split across the notes
 * still waiting, so one long note cannot take it all; a slice smaller than
 * `MIN_NOTE_PART` is not sent.
 */
function note_char_share(budget: number, notes_left: number): number {
	if (notes_left < 1 || budget < MIN_NOTE_PART) return 0
	return Math.min(budget, Math.max(MIN_NOTE_PART, Math.floor(budget / notes_left)))
}
const MAX_LISTED_NAMES = 200

export type SummaryEntry = { id: string; name: string; type: 'file' | 'folder' }

export type SummarySources = {
	names: string[]
	notes: { name: string; text: string }[]
	images: { name: string; url: string }[]
	/** notes whose whole text was sent; a shortened one is in `notes` but not here */
	notes_full: number
	notes_total: number
	images_total: number
	/** the model is known not to take images, so none were read */
	images_refused: boolean
}

/**
 * Reads what a summary is made of, in board order: every name, the start of
 * each note (the text budget is shared, so one long note cannot crowd the
 * rest out), and up to `MAX_SUMMARY_IMAGES` reduced images (none when the
 * model is known to refuse them; an undecodable one is passed over).
 * Nothing is sent from here.
 */
export async function collect_summary_sources(
	workspace: Pick<NameSources, 'read_note_content' | 'get_media_src'>,
	entries: readonly SummaryEntry[],
	options: { images_refused: boolean; signal?: AbortSignal; on_progress?: (done: number, total: number) => void },
): Promise<SummarySources> {
	const sources: SummarySources = {
		names: entries.slice(0, MAX_LISTED_NAMES).map(entry => (entry.type === 'folder' ? `${entry.name}/` : entry.name)),
		notes: [],
		images: [],
		notes_full: 0,
		notes_total: 0,
		images_total: 0,
		images_refused: options.images_refused,
	}
	let budget = SUMMARY_TEXT_LIMIT
	let notes_left = entries.filter(entry => entry.type === 'file' && is_note_name(entry.name)).length
	let done = 0
	for (const entry of entries) {
		if (options.signal?.aborted) break
		if (entry.type === 'file' && is_note_name(entry.name)) {
			const share = note_char_share(budget, notes_left)
			notes_left--
			sources.notes_total++
			if (share > 0) {
				try {
					const text = (await workspace.read_note_content(entry.id)).trim()
					if (text) {
						const part = text.slice(0, share)
						sources.notes.push({ name: entry.name, text: part })
						if (part.length === text.length) sources.notes_full++
						budget -= part.length
					} else {
						// an empty note has nothing to leave out
						sources.notes_total--
					}
				} catch {
					// unreadable: counted in notes_total so coverage shows it was left out
				}
			}
		} else if (entry.type === 'file' && get_media_kind(entry.name) === 'image') {
			sources.images_total++
			if (!options.images_refused && sources.images.length < MAX_SUMMARY_IMAGES) {
				const url = await image_to_data_url(workspace, entry.id, entry.name)
				if (url) sources.images.push({ name: entry.name, url })
			}
		}
		options.on_progress?.(++done, entries.length)
	}
	return sources
}

/**
 * "12 of 40 images and 30 of 52 notes included", plus ", shortened to fit"
 * when a note was cut. A shortened note counts as included — its beginning
 * was sent — but not as included whole. Null when everything fit whole.
 */
export function coverage_line(sources: SummarySources): string | null {
	const parts: string[] = []
	if (sources.images.length < sources.images_total) {
		parts.push(`${sources.images.length} of ${sources.images_total} images`)
	}
	const notes_shortened = sources.notes_full < sources.notes.length
	if (sources.notes.length < sources.notes_total || notes_shortened) {
		parts.push(`${sources.notes.length} of ${sources.notes_total} notes`)
	}
	if (!parts.length) return null
	const line = `${parts.join(' and ')} included${notes_shortened ? ', shortened to fit' : ''}`
	return sources.images_refused && sources.images_total
		? `${line}: the model doesn't accept images`
		: line
}

const SYSTEM_PROMPT = [
	'You summarize a board in a visual file manager: its files, notes and images.',
	'Write Markdown: a short title as "# …", then 3 to 7 bullet points on what the board is about and what stands out.',
	'Write in the language of the content. No preamble, no closing remarks.',
].join(' ')

export function build_summary_messages(sources: SummarySources, board_name: string): AiMessage[] {
	const text = [
		`Board "${board_name}" holds:`,
		sources.names.map(name => `- ${name}`).join('\n') || '(nothing)',
		...sources.notes.map(note => `\n## Note "${note.name}"\n${note.text}`),
	].join('\n')
	const content: AiContentPart[] = [{ type: 'text', text }]
	for (const image of sources.images) {
		content.push({ type: 'text', text: `Image "${image.name}":` })
		content.push({ type: 'image_url', image_url: { url: image.url } })
	}
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		{ role: 'user', content: sources.images.length ? content : text },
	]
}

/** Board widgets as summary entries; shapes and other files count by name. */
export function summary_entries(widgets: readonly FolderContainerWidgetChild[]): SummaryEntry[] {
	return widgets.map(widget => ({
		id: widget.id,
		name: widget.name,
		type: widget.type === 'file' ? 'file' : 'folder',
	}))
}

const NOTE_GAP = 24

/**
 * Where the summary note goes: right of the summarized widgets, level with
 * the topmost. Null when they carry no board position (list, grid, stack),
 * so the folder places the note itself.
 */
export function summary_position(widgets: readonly { position?: Position; size?: Size }[]): Position | null {
	const placed = widgets.filter((widget): widget is { position: Position; size?: Size } => !!widget.position)
	if (!placed.length) return null
	const right = Math.max(...placed.map(widget => widget.position.x + (widget.size?.width ?? 0)))
	const top = Math.min(...placed.map(widget => widget.position.y))
	return { x: right + NOTE_GAP, y: top }
}

/** `Summary.md`, numbered when taken, compared as the file system does. */
export function summary_note_name(sibling_names: Iterable<string>): string {
	return resolve_unique_filename('Summary.md', sibling_names, { ignore_case: true })
}

/**
 * Adds the summary as a new note: created where asked, filled, then named
 * `Summary.md` (numbered when taken). A failed rename leaves the saved note
 * under its `Note N.md` name rather than losing it. The model answer is
 * not trusted: reasoning is removed, HTML is escaped, markdown images go.
 */
export async function add_summary_note(
	workspace: Pick<WorkspaceStore, 'create_note' | 'save_note_content' | 'resolve_folder_data' | 'rename'>,
	folder_id: string,
	text: string,
	position: Position | null,
): Promise<void> {
	const note_id = await workspace.create_note(folder_id, position ?? undefined)
	if (!note_id) throw new Error('The note could not be created')
	await workspace.save_note_content(note_id, `${untrusted_markdown(strip_think(text)).trim()}\n`)
	const siblings = (workspace.resolve_folder_data(folder_id)?.children ?? [])
		.filter(child => child.id !== note_id)
		.map(child => child.name)
	try {
		await workspace.rename(note_id, summary_note_name(siblings), { report: false })
	} catch {
		// the summary is saved; it keeps the "Note N.md" name
	}
}

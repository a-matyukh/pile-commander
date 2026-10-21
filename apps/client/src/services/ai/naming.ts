import { get_media_kind } from '@/services/board/media'
import { strip_think } from './text'
import type { AiMessage } from './types'

/** How much of a note goes into a naming request. */
export const NAME_NOTE_CHAR_LIMIT = 4000
/** How many children of a folder are listed. */
export const NAME_FOLDER_CHILD_LIMIT = 60
/** How many of those notes contribute their first line. */
export const NAME_FOLDER_NOTE_LIMIT = 12
const NAME_MAX_LENGTH = 80

export type NameTargetKind = 'note' | 'folder' | 'image'

export type NameTarget =
	| { kind: 'note'; name: string; text: string }
	| { kind: 'folder'; name: string; children: { name: string; first_line: string | null }[] }
	| { kind: 'image'; name: string; image_url: string }

export function is_note_name(name: string): boolean {
	const lower = name.toLowerCase()
	return lower.endsWith('.md') || lower.endsWith('.txt')
}

/** What a name can be suggested for; other files have nothing to read. */
export function name_target_kind(entry: { name: string; type: 'file' | 'folder' }): NameTargetKind | null {
	if (entry.type === 'folder') return 'folder'
	if (is_note_name(entry.name)) return 'note'
	if (get_media_kind(entry.name) === 'image') return 'image'
	return null
}

/** How suggested names are written: `Meeting notes`, `meeting-notes` or `meeting_notes`. */
export type NameStyle = 'spaces' | 'kebab' | 'snake'

export const NAME_STYLES: readonly { value: NameStyle; label: string }[] = [
	{ value: 'spaces', label: 'Meeting notes' },
	{ value: 'kebab', label: 'meeting-notes' },
	{ value: 'snake', label: 'meeting_notes' },
]

const STYLE_RULES: Record<NameStyle, string> = {
	spaces: 'words separated by spaces, first letter capitalized, the rest lowercase except proper names',
	kebab: 'lowercase, words joined by hyphens',
	snake: 'lowercase, words joined by underscores',
}

function system_prompt(style: NameStyle): string {
	return [
		'You name files and folders in a visual file manager.',
		`Reply with the name only: 2 to 6 words, ${STYLE_RULES[style]}, in the language of the content.`,
		'No file extension, no quotes, no explanation.',
	].join(' ')
}

export function first_line(text: string): string | null {
	const line = text.split('\n').map(part => part.replace(/^#+\s*/, '').trim()).find(Boolean)
	return line ? line.slice(0, 120) : null
}

export function build_name_messages(target: NameTarget, style: NameStyle = 'spaces'): AiMessage[] {
	const system: AiMessage = { role: 'system', content: system_prompt(style) }
	switch (target.kind) {
		case 'note':
			return [system, {
				role: 'user',
				content: `Name this note (now "${target.name}"):\n\n${target.text.slice(0, NAME_NOTE_CHAR_LIMIT)}`,
			}]
		case 'folder': {
			const listing = target.children
				.slice(0, NAME_FOLDER_CHILD_LIMIT)
				.map(child => (child.first_line ? `- ${child.name}: ${child.first_line}` : `- ${child.name}`))
				.join('\n')
			return [system, {
				role: 'user',
				content: `Name this folder (now "${target.name}") by what it holds:\n\n${listing || '(empty)'}`,
			}]
		}
		case 'image':
			return [system, {
				role: 'user',
				content: [
					{ type: 'text', text: `Name this image (now "${target.name}") by what it shows.` },
					{ type: 'image_url', image_url: { url: target.image_url } },
				],
			}]
	}
}

function extension_of(name: string): string {
	const dot = name.lastIndexOf('.')
	return dot > 0 ? name.slice(dot) : ''
}

/** Extensions a model may tack on; anything else after a dot is part of the name (`release-v2.0`). */
const OTHER_FILE_EXTENSIONS = new Set(['.svg', '.pdf', '.heic', '.heif', '.tif', '.tiff', '.dng', '.raw', '.jpe'])

function is_file_extension(extension: string, original_name: string): boolean {
	const lower = extension.toLowerCase()
	return lower === extension_of(original_name).toLowerCase()
		|| OTHER_FILE_EXTENSIONS.has(lower)
		|| is_note_name(`x${lower}`)
		|| get_media_kind(`x${lower}`) !== null
}

/** An answer of just `.png` is all extension, so a leading dot counts here. */
function drop_known_extension(name: string, original_name: string): string {
	const dot = name.lastIndexOf('.')
	if (dot === -1) return name
	const extension = name.slice(dot)
	return is_file_extension(extension, original_name) ? name.slice(0, dot) : name
}

/** `**name**`, `__name__`, `` `name` ``: the markers around the whole answer, not an `_` inside a word. */
function unwrap_markdown(text: string): string {
	let result = text.trim()
	for (;;) {
		const match = /^([`*_]+)(.+?)\1$/.exec(result)
		if (!match) return result
		result = match[2]!.trim()
	}
}

/**
 * Brings an answer to the chosen style when the model ignored it. A spaced
 * name keeps its capitals; only an all-lowercase first word is capitalized
 * (`iPhone photos` stays as is).
 */
export function apply_name_style(name: string, style: NameStyle): string {
	if (style === 'kebab') return name.toLocaleLowerCase().replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-')
	if (style === 'snake') return name.toLocaleLowerCase().replace(/[\s-]+/g, '_').replace(/_{2,}/g, '_')
	const spaced = /\s/.test(name) ? name : name.replace(/[-_]+/g, ' ').trim()
	const [first = ''] = spaced.split(' ')
	if (first && first === first.toLocaleLowerCase()) {
		return spaced.charAt(0).toLocaleUpperCase() + spaced.slice(1)
	}
	return spaced
}

/**
 * A model's answer as a file or folder name: the reasoning, labels, quotes
 * and markdown dropped, characters no file system takes removed, the style
 * applied, the length capped, and the original extension kept (one the
 * model added is dropped). Null when nothing usable is left.
 */
export function sanitize_suggested_name(
	raw: string,
	original_name: string,
	type: 'file' | 'folder',
	style?: NameStyle,
): string | null {
	const line = strip_think(raw)
		.split('\n')
		.map(part => part.trim())
		.find(Boolean)
	if (!line) return null

	let name = line
		// a label needs a colon: `name-tags-on-table` is a name, not a label
		.replace(/^(new\s+)?(file\s*|folder\s*)?name\s*[:：]\s*/i, '')
		.replace(/^(#+|>)\s*/, '')
		.replace(/["'«»“”„‘’]/g, '')
	name = unwrap_markdown(name)
		.replace(/[`*]/g, '')
		.replace(/\p{Cc}/gu, ' ')
		.replace(/[/\\:?<>|]/g, '-')
		.replace(/\s+/g, ' ')
		.trim()
	if (type === 'file') name = drop_known_extension(name, original_name)
	if (style) name = apply_name_style(name, style)
	name = [...name].slice(0, NAME_MAX_LENGTH).join('')
	name = name.replace(/^[\s.\-]+|[\s.\-]+$/g, '')
	if (!name) return null
	return type === 'file' ? `${name}${extension_of(original_name)}` : name
}

/**
 * A note shown outside editing: its markdown read into the note schema and
 * rendered by the same rules the editor uses, so a note looks the same in
 * and out of editing. The HTML still goes through the note sanitizer: the
 * schema already lets nothing else through, this keeps it so if an
 * extension ever renders more than it should.
 */
import { getHTMLFromFragment, getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'
import { parseNoteMarkdown, sanitizeNoteHtml } from '../../ui/workspace/folder-container/widgets/markdown'
import { note_extensions, type Align } from './extensions'
import { parse_note } from './markdown'

const schemas = new Map<Align, Schema>()

const escape_html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * Front matter shows as its source; another raw block through the old preview
 * pipeline (marked + sanitizer); a raw inline piece is HTML, sanitized.
 */
function raw_html(raw: string, inline: boolean): string {
	if (inline) return sanitizeNoteHtml(raw)
	if (/^---[ \t]*\n/.test(raw)) return `<pre data-front-matter="">${escape_html(raw)}</pre>`
	return parseNoteMarkdown(raw)
}

function render_schema(default_align: Align): Schema {
	let schema = schemas.get(default_align)
	if (!schema) {
		schema = getSchema(note_extensions({ default_align, raw_html }))
		schemas.set(default_align, schema)
	}
	return schema
}

/** A board shows each note's preview many times; the same text renders once. */
const CACHE_LIMIT = 400
const cache = new Map<string, string>()

export function render_note_html(markdown: string, default_align: Align = 'left'): string {
	if (!markdown) return ''
	const key = `${default_align}\n${markdown}`
	const hit = cache.get(key)
	if (hit !== undefined) {
		cache.delete(key)
		cache.set(key, hit)
		return hit
	}
	let html: string
	try {
		const schema = render_schema(default_align)
		const doc = schema.nodeFromJSON(parse_note(markdown, default_align))
		html = sanitizeNoteHtml(getHTMLFromFragment(doc.content, schema))
	} catch (error) {
		// A note the schema cannot take still shows, the way it did before.
		console.warn('[text] note rendered by the fallback', error)
		html = parseNoteMarkdown(markdown)
	}
	cache.set(key, html)
	if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!)
	return html
}

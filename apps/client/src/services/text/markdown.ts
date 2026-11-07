/**
 * A note's markdown read into the note schema and written back. One reader
 * per default alignment serves every note, the preview and the editor alike:
 * Tiptap's MarkdownManager keeps no state between calls, and each registers
 * its tokenizers on a `marked` of its own, never on the app's shared one.
 */
import { getHTMLFromFragment, getSchema } from '@tiptap/core'
import type { JSONContent, MarkdownToken } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { DOMParser as SchemaDOMParser, type Schema } from '@tiptap/pm/model'
import { Marked } from 'marked'
import { minimal_escape } from './escape'
import { note_extensions, plain_inline_html, style_value, type Align } from './extensions'
import { DEFAULT_BG, is_bg_color, is_text_color, normalize_hex } from './palette'

export type NoteMarkdown = {
	readonly schema: Schema
	/** A document for the note schema; never empty (one paragraph at least). */
	parse(markdown: string): JSONContent
	serialize(doc: JSONContent): string
}

type ManagerOptions = NonNullable<ConstructorParameters<typeof MarkdownManager>[0]>

/** The private methods of MarkdownManager this module wraps, and what they read. */
type ManagerInternals = {
	codeTypes: Set<string>
	parseHTMLToken(token: MarkdownToken): JSONContent | JSONContent[] | null
	parseInlineTokens(tokens: MarkdownToken[]): JSONContent[]
	encodeTextForMarkdown(text: string, node: JSONContent, parent?: JSONContent): string
}

let entity_decoder: HTMLTextAreaElement | null = null

/**
 * Named entities (`&copy;`, `&mdash;`) as numeric ones, which Tiptap decodes;
 * it decodes only `&amp; &lt; &gt; &quot;` by name and would show the rest
 * literally. A textarea reads its content as text, so this runs no markup.
 */
function numeric_entities(text: string): string {
	if (!text.includes('&') || typeof document === 'undefined') return text
	return text.replace(/&([a-zA-Z][a-zA-Z0-9]{1,31});/g, (match, name: string) => {
		if (name === 'amp' || name === 'lt' || name === 'gt' || name === 'quot') return match
		entity_decoder ??= document.createElement('textarea')
		entity_decoder.innerHTML = match
		const value = entity_decoder.value
		if (value === match) return match
		return [...value].map(ch => `&#${ch.codePointAt(0)};`).join('')
	})
}

/** The inline tags the schema reads; any other inline tag is kept as written. */
const INLINE_TAGS: ReadonlySet<string> = new Set([
	'a', 'b', 'br', 'code', 'del', 'em', 'i', 'img', 'mark', 's', 'small', 'span', 'strike', 'strong', 'sub', 'sup', 'u',
])

/** An HTML comment or an inline element outside the schema (`<kbd>K</kbd>`), as a raw inline node. */
function raw_inline(raw: string): JSONContent | null {
	if (/^<!--[\s\S]*-->$/.test(raw)) return { type: 'rawInline', attrs: { raw } }
	const tag = /^<([a-z][a-z0-9-]*)\b/i.exec(raw)?.[1]?.toLowerCase()
	if (!tag || INLINE_TAGS.has(tag)) return null
	if (!new RegExp(`</${tag}\\s*>$`, 'i').test(raw)) return null
	return { type: 'rawInline', attrs: { raw } }
}

const mark_type = (mark: unknown) => typeof mark === 'string' ? mark : (mark as { type?: string } | null)?.type

const ALIGNED_BLOCK = /^<(p|h[1-6])\s+align\s*=\s*["']?(?:left|center|right)["']?\s*>([\s\S]*)<\/\1\s*>$/i

/**
 * `<p align="center">…</p>` (or a heading) holding only inline tags: the
 * shape this module writes for an aligned block, read back through the
 * schema. Anything else is not ours to interpret.
 */
function parse_aligned_block(raw: string, schema: Schema): JSONContent[] | null {
	const match = ALIGNED_BLOCK.exec(raw.trim())
	if (!match) return null
	const inner = match[2]!
	if (inner.includes('<!--')) return null
	for (const tag of inner.matchAll(/<\/?([a-z][a-z0-9-]*)/gi)) {
		if (!INLINE_TAGS.has(tag[1]!.toLowerCase())) return null
	}
	if (typeof window === 'undefined' || typeof window.DOMParser === 'undefined') return null
	const body = new window.DOMParser().parseFromString(raw.trim(), 'text/html').body
	const content = SchemaDOMParser.fromSchema(schema).parse(body).toJSON().content as JSONContent[] | undefined
	return content?.length === 1 ? content : null
}

/**
 * Inline content as HTML, for an aligned block: what the schema renders,
 * without the link's own target, and with colour tags written the way the
 * markdown marks write them (a DOM may report `rgb(…);`).
 */
function inline_html(schema: Schema, content: JSONContent[]): string {
	if (typeof document === 'undefined') return plain_inline_html(content)
	const paragraph = schema.nodeFromJSON({ type: 'paragraph', content })
	return getHTMLFromFragment(paragraph.content, schema)
		.replace(/<a\b[^>]*>/g, tag => tag.replace(/\s(?:target|rel)="[^"]*"/g, ''))
		.replace(/<span\b[^>]*>/g, (tag) => {
			const color = normalize_hex(style_value(tag, 'color'))
			return is_text_color(color) ? `<span style="color: ${color}">` : '<span>'
		})
		.replace(/<mark\b[^>]*>/g, (tag) => {
			const color = normalize_hex(style_value(tag, 'background-color'))
			return `<mark style="background-color: ${is_bg_color(color) ? color : DEFAULT_BG}">`
		})
}

/**
 * YAML front matter at the very top (`---` … `---`), kept as a raw block.
 * Without this it reads as a line and a heading and is written back as such.
 * Only when its lines look like YAML: a note may also start with a line and
 * a heading on purpose.
 */
export function split_front_matter(markdown: string): { front: string | null; body: string } {
	const match = /^---[ \t]*\n([\s\S]*?)\n(?:---|\.\.\.)[ \t]*(?:\n|$)/.exec(markdown)
	if (!match) return { front: null, body: markdown }
	const lines = match[1]!.split('\n')
	const key = /^[^\s:#-][^:]*:(?:[ \t]|$)/
	const yaml = lines.every(line => !line.trim() || key.test(line) || /^(?:[ \t]+\S|-[ \t]|#)/.test(line))
	if (!yaml || !lines.some(line => key.test(line))) return { front: null, body: markdown }
	return { front: match[0].replace(/\n$/, ''), body: markdown.slice(match[0].length) }
}

/**
 * Text gets only the escaping it needs (see escape.ts); a block of HTML the
 * schema does not know becomes a raw block instead of literal text or
 * nothing, and so does an inline comment or unknown tag (`<kbd>`); a lone
 * `<br>` skips Tiptap's whole-schema HTML parse. Text after a line break
 * loses its leading spaces, as markdown has it: Tiptap's ordered-list reader
 * leaves one there. An entity is no space yet, so `&#9;` keeps a Tab.
 */
function patch_manager(manager: MarkdownManager, schema: Schema) {
	const internals = manager as unknown as ManagerInternals
	const parse_html = internals.parseHTMLToken.bind(manager)
	const parse_inline = internals.parseInlineTokens.bind(manager)
	internals.parseInlineTokens = tokens => parse_inline(tokens.map((token, index) => {
		if (token.type !== 'text') return token
		let text = String(token.text ?? '')
		if (tokens[index - 1]?.type === 'br') text = text.replace(/^[ \t]+/, '')
		text = numeric_entities(text)
		return text === token.text ? token : { ...token, text }
	}))
	internals.encodeTextForMarkdown = (text, node, parent) => {
		const marks = (node.marks ?? []) as unknown[]
		const in_code = (parent?.type != null && internals.codeTypes.has(parent.type))
			|| marks.some(mark => internals.codeTypes.has(mark_type(mark) ?? ''))
		if (in_code) return text
		return minimal_escape(text, marks.some(mark => mark_type(mark) === 'link'))
	}
	internals.parseHTMLToken = (token) => {
		const raw = String(token.raw ?? token.text ?? '')
		if (!token.block) {
			if (/^<br\s*\/?>$/i.test(raw.trim())) return { type: 'hardBreak' }
			return raw_inline(raw.trim()) ?? parse_html(token)
		}
		const block = raw.replace(/\s+$/, '')
		if (!block.trim()) return null
		return parse_aligned_block(block, schema) ?? { type: 'rawBlock', attrs: { raw: block } }
	}
}

function create_note_markdown(default_align: Align): NoteMarkdown {
	const holder: { schema: Schema | null } = { schema: null }
	const extensions = note_extensions({
		default_align,
		inline_html: content => inline_html(holder.schema!, content),
	})
	const schema = getSchema(extensions)
	holder.schema = schema
	const manager = new MarkdownManager({
		marked: new Marked() as unknown as ManagerOptions['marked'],
		markedOptions: { gfm: true, breaks: true },
		extensions,
	})
	patch_manager(manager, schema)
	return {
		schema,
		parse(markdown) {
			const { front, body } = split_front_matter(String(markdown ?? '').replace(/\r\n?/g, '\n'))
			const content = [...(manager.parse(body).content ?? [])]
			if (front !== null) content.unshift({ type: 'rawBlock', attrs: { raw: front } })
			if (!content.length) content.push({ type: 'paragraph' })
			return { type: 'doc', content }
		},
		serialize(doc) {
			// Whitespace at either end of a note means nothing.
			return manager.serialize(doc).replace(/^\n+/, '').replace(/\s+$/, '')
		},
	}
}

const readers = new Map<Align, NoteMarkdown>()

export function note_markdown(default_align: Align = 'left'): NoteMarkdown {
	let reader = readers.get(default_align)
	if (!reader) {
		reader = create_note_markdown(default_align)
		readers.set(default_align, reader)
	}
	return reader
}

export function parse_note(markdown: string, default_align: Align = 'left'): JSONContent {
	return note_markdown(default_align).parse(markdown)
}

export function serialize_note(doc: JSONContent, default_align: Align = 'left'): string {
	return note_markdown(default_align).serialize(doc)
}

/**
 * The schema of a note or a text block: one list of Tiptap extensions that
 * reads, writes and (from stage 1.3) edits it. The note stays a `.md` file; the
 * format table in TEXT_EDITING_PLAN.md says what each construct writes.
 *
 * HTML inside the markdown is read only through these rules, so the schema is
 * the white list: a colour outside the palette, a `style` of its own, a
 * `javascript:` link do not survive. A block this schema does not know becomes
 * a raw block and is written back byte for byte.
 */
import { Extension, Mark, Node } from '@tiptap/core'
import type { AnyExtension, JSONContent, MarkdownLexerConfiguration, MarkdownToken, MarkdownTokenizer } from '@tiptap/core'
import { StarterKit } from '@tiptap/starter-kit'
import { CodeBlock } from '@tiptap/extension-code-block'
import { HardBreak } from '@tiptap/extension-hard-break'
import { Heading, type HeadingOptions } from '@tiptap/extension-heading'
import { Image } from '@tiptap/extension-image'
import { Link } from '@tiptap/extension-link'
import { BulletList, OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import { Paragraph, type ParagraphOptions } from '@tiptap/extension-paragraph'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import { Table, TableKit, renderTableToMarkdown } from '@tiptap/extension-table'
import { Underline } from '@tiptap/extension-underline'
import { minimal_escape, protect_heading_end, protect_line_starts } from './escape'
import { DEFAULT_BG, is_bg_color, is_text_color, normalize_hex } from './palette'

export type Align = 'left' | 'center' | 'right'

const ALIGNS: ReadonlySet<string> = new Set(['left', 'center', 'right'])

export type NoteExtensionOptions = {
	/** The alignment a block has when the file says nothing: a shape centres its text. */
	default_align?: Align
	/**
	 * Sanitized HTML that shows a raw block (markdown with HTML in it) or a raw
	 * inline piece (HTML). Without it a raw block shows its source.
	 */
	raw_html?: (raw: string, inline: boolean) => string
	/**
	 * HTML for a block's inline content, used where markdown cannot carry the
	 * block (an aligned paragraph). The markdown module supplies it; nothing
	 * else serializes.
	 */
	inline_html?: (content: JSONContent[]) => string
}

function parse_align(value: string | null | undefined, default_align: Align): Align | null {
	const align = String(value ?? '').trim().toLowerCase()
	if (!ALIGNS.has(align) || align === default_align) return null
	return align as Align
}

const escape_html = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Inline content as plain HTML text, marks left out: the fallback without a DOM. */
export const plain_inline_html = (content: JSONContent[]): string =>
	content.map(node => node.type === 'text' ? escape_html(node.text ?? '') : node.type === 'hardBreak' ? '<br>' : '').join('')

/** One CSS property out of an HTML tag's `style` attribute, as written. */
export function style_value(open_tag: string, property: string): string | null {
	const style = /\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(open_tag)
	if (!style) return null
	for (const part of (style[1] ?? style[2] ?? '').split(';')) {
		const colon = part.indexOf(':')
		if (colon < 0) continue
		if (part.slice(0, colon).trim().toLowerCase() === property) return part.slice(colon + 1).trim()
	}
	return null
}

// ─── Inline HTML marks ─────────────────────────────────────────────────────

type HtmlMarkMatch = { open: string; inner: string; raw: string }

/**
 * `<tag …>…</tag>` at the start of `src`, with the same tag nested inside
 * counted, and a closing tag inside a code span or after a backslash ignored.
 */
function match_html_mark(src: string, tag: string): HtmlMarkMatch | null {
	const open = new RegExp(`^<${tag}(?:\\s[^<>]*)?>`, 'i').exec(src)
	if (!open) return null
	const delimiters = new RegExp(`\\\\[\\s\\S]|\`+|<${tag}(?:\\s[^<>]*)?>|</${tag}\\s*>`, 'gi')
	delimiters.lastIndex = open[0].length
	let depth = 1
	for (let match = delimiters.exec(src); match; match = delimiters.exec(src)) {
		const found = match[0]
		if (found.startsWith('\\')) continue
		if (found.startsWith('`')) {
			const span = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/.exec(src.slice(match.index))
			if (span) delimiters.lastIndex = match.index + span[0].length
			continue
		}
		if (found.startsWith('</')) {
			depth--
			if (depth === 0) return { open: open[0], inner: src.slice(open[0].length, match.index), raw: src.slice(0, match.index + found.length) }
		} else depth++
	}
	return null
}

/**
 * Reads `<tag …>markdown</tag>` as a mark over its content, which is read as
 * markdown. Tiptap's own reading of inline HTML takes the content as HTML,
 * so `<span style="color: …">a **b**</span>` would come back with literal
 * asterisks. `read` returns the mark's attributes, or null when the tag
 * carries nothing the schema keeps (a colour outside the palette): then only
 * its content is kept, still read as markdown.
 */
function html_mark_tokenizer(name: string, tag: string, read: (open_tag: string) => Record<string, unknown> | null): MarkdownTokenizer {
	const start = new RegExp(`<${tag}[\\s>]`, 'i')
	return {
		name,
		level: 'inline',
		start: (src: string) => src.search(start),
		tokenize: (src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) => {
			const found = match_html_mark(src, tag)
			if (!found || !found.inner) return undefined
			return { type: name, raw: found.raw, text: found.inner, attrs: read(found.open), tokens: lexer.inlineTokens(found.inner) }
		},
	}
}

/**
 * Adds a mark to the text that does not carry one of the same type yet: in
 * nested spans the inner colour wins, the way it shows in HTML, and a text
 * node never ends up with two marks of one type.
 */
function mark_content(type: string, content: JSONContent[], attrs?: Record<string, unknown> | null): JSONContent[] {
	if (attrs === null) return content
	const mark = attrs && Object.keys(attrs).length > 0 ? { type, attrs } : { type }
	return content.map((node) => {
		if (node.type !== 'text') return node
		const marks = node.marks ?? []
		if (marks.some(m => m.type === type)) return node
		return { ...node, marks: [...marks, mark] }
	})
}

/**
 * HTML marks sit outside `**` and `*`: `a<span …>**b**</span>c` reads back as
 * bold inside a word, `a**<span …>b</span>**c` does not (a delimiter next to
 * `<` cannot open in the middle of a word). Links stay outermost (1000).
 */
const HTML_MARK_PRIORITY = 150

const TextColor = Mark.create({
	name: 'textColor',
	priority: HTML_MARK_PRIORITY,
	addAttributes() {
		return { color: { default: null, rendered: false } }
	},
	parseHTML() {
		return [{
			tag: 'span[style]',
			getAttrs: (element) => {
				const color = normalize_hex((element as HTMLElement).style.color)
				return is_text_color(color) ? { color } : false
			},
		}]
	},
	renderHTML({ mark }) {
		const color = mark.attrs.color as string | null
		return ['span', is_text_color(color) ? { style: `color: ${color}` } : {}, 0]
	},
	markdownTokenizer: html_mark_tokenizer('textColor', 'span', (open) => {
		const color = normalize_hex(style_value(open, 'color'))
		return is_text_color(color) ? { color } : null
	}),
	parseMarkdown(token, helpers) {
		return mark_content('textColor', helpers.parseInline(token.tokens ?? []), token.attrs)
	},
	renderMarkdown(node, h) {
		return `<span style="color: ${node.attrs?.color}">${h.renderChildren(node)}</span>`
	},
})

/** A `<mark>` without a colour of the palette reads as the yellow highlighter. */
const bg_from = (value: string | null): string => {
	const color = normalize_hex(value)
	return is_bg_color(color) ? color : DEFAULT_BG
}

const BgColor = Mark.create({
	name: 'bgColor',
	priority: HTML_MARK_PRIORITY,
	addAttributes() {
		return { color: { default: DEFAULT_BG, rendered: false } }
	},
	parseHTML() {
		return [{
			tag: 'mark',
			getAttrs: (element) => ({ color: bg_from((element as HTMLElement).style.backgroundColor || null) }),
		}]
	},
	renderHTML({ mark }) {
		const color = mark.attrs.color as string | null
		return ['mark', { style: `background-color: ${is_bg_color(color) ? color : DEFAULT_BG}` }, 0]
	},
	markdownTokenizer: html_mark_tokenizer('bgColor', 'mark', open => ({
		color: bg_from(style_value(open, 'background-color') ?? style_value(open, 'background')),
	})),
	parseMarkdown(token, helpers) {
		return mark_content('bgColor', helpers.parseInline(token.tokens ?? []), token.attrs)
	},
	renderMarkdown(node, h) {
		return `<mark style="background-color: ${node.attrs?.color ?? DEFAULT_BG}">${h.renderChildren(node)}</mark>`
	},
})

const Small = Mark.create({
	name: 'small',
	priority: HTML_MARK_PRIORITY,
	parseHTML() {
		return [{ tag: 'small' }]
	},
	renderHTML() {
		return ['small', 0]
	},
	markdownTokenizer: html_mark_tokenizer('small', 'small', () => ({})),
	parseMarkdown(token, helpers) {
		return mark_content('small', helpers.parseInline(token.tokens ?? []))
	},
	renderMarkdown(node, h) {
		return `<small>${h.renderChildren(node)}</small>`
	},
})

const NoteSubscript = Subscript.extend({
	priority: HTML_MARK_PRIORITY,
	markdownTokenizer: html_mark_tokenizer('subscript', 'sub', () => ({})),
	parseMarkdown(token, helpers) {
		return mark_content('subscript', helpers.parseInline(token.tokens ?? []))
	},
	renderMarkdown(node, h) {
		return `<sub>${h.renderChildren(node)}</sub>`
	},
})

const NoteSuperscript = Superscript.extend({
	priority: HTML_MARK_PRIORITY,
	markdownTokenizer: html_mark_tokenizer('superscript', 'sup', () => ({})),
	parseMarkdown(token, helpers) {
		return mark_content('superscript', helpers.parseInline(token.tokens ?? []))
	},
	renderMarkdown(node, h) {
		return `<sup>${h.renderChildren(node)}</sup>`
	},
})

/** Tiptap's underline already reads `<u>` as markdown; it only moves outside `**`. */
const NoteUnderline = Underline.extend({ priority: HTML_MARK_PRIORITY })

// ─── Links and images ──────────────────────────────────────────────────────

const balanced_parens = (value: string) => {
	let depth = 0
	for (const ch of value) {
		if (ch === '(') depth++
		else if (ch === ')' && --depth < 0) return false
	}
	return depth === 0
}

/** A link or image destination, in `<…>` when spaces or brackets would end it early. */
function markdown_destination(href: string): string {
	if (!/[\s<>]/.test(href) && balanced_parens(href)) return href
	return `<${href.replace(/[<>]/g, ch => encodeURIComponent(ch))}>`
}

const markdown_title = (title: string) => title ? ` "${title.replace(/["\\]/g, '\\$&')}"` : ''

/**
 * Whether a link reads back as itself without brackets: its text is its
 * address (`https://…`, an e-mail, a `www.` address) and needs no escaping.
 */
const is_self_link = (text: string, href: string) =>
	text !== '' && minimal_escape(text, true) === text
	&& (text === href || `mailto:${text}` === href || `http://${text}` === href)

/**
 * A link remembers how it was written: `autolink` is `bare` for an address
 * typed as is (also every link made in the editor), `angle` for `<https://…>`
 * and null for `[text](address)`. A bare or angle link whose text is still
 * its address is written back the same way, so `https://example.com` does not
 * turn into `[https://example.com](https://example.com)` on the first edit.
 */
const NoteLink = Link.extend({
	addAttributes() {
		return { ...this.parent?.(), autolink: { default: 'bare', rendered: false } }
	},
	parseMarkdown(token, helpers) {
		const raw = String(token.raw ?? '')
		return helpers.applyMark('link', helpers.parseInline(token.tokens ?? []), {
			href: token.href,
			title: token.title || null,
			autolink: raw.startsWith('[') ? null : raw.startsWith('<') ? 'angle' : 'bare',
		})
	},
	renderMarkdown(node, h, ctx) {
		const href = String(node.attrs?.href ?? '')
		const title = node.attrs?.title ? String(node.attrs.title) : ''
		const text = ctx?.meta?.markText
		// A mark built outside the schema may lack the attribute: then it has the default.
		const autolink = node.attrs?.autolink === undefined ? 'bare' : node.attrs.autolink
		if (autolink && !title && typeof text === 'string' && is_self_link(text, href)) {
			return autolink === 'angle' ? `<${h.renderChildren(node)}>` : h.renderChildren(node)
		}
		return `[${h.renderChildren(node)}](${markdown_destination(href)}${markdown_title(title)})`
	},
})

/** An image source the preview may load: web, blob, a raster or SVG data URI, or a relative path. */
function safe_image_src(src: string | null | undefined): string | null {
	const value = String(src ?? '').trim()
	if (!value) return null
	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(value)
	if (!scheme) return value
	const name = scheme[1]!.toLowerCase()
	if (name === 'http' || name === 'https' || name === 'blob') return value
	if (name === 'data' && /^data:image\//i.test(value)) return value
	return null
}

/**
 * Images are inline, as in markdown: `text ![](a.png) text` keeps its place.
 * Tiptap's block image would drop one that shares a line with text.
 */
const NoteImage = Image.extend({
	renderHTML({ HTMLAttributes }) {
		return ['img', { ...HTMLAttributes, src: safe_image_src(HTMLAttributes.src as string | null) }]
	},
	renderMarkdown(node) {
		const src = String(node.attrs?.src ?? '')
		const alt = String(node.attrs?.alt ?? '')
		const title = node.attrs?.title ? String(node.attrs.title) : ''
		return `![${alt}](${markdown_destination(src)}${markdown_title(title)})`
	},
})

// ─── Blocks ────────────────────────────────────────────────────────────────

const aligned_html = (tag: string, inner: string, align: string) => `<${tag} align="${align}">${inner}</${tag}>`

type BlockHtmlOptions = {
	inline_html: (content: JSONContent[]) => string
}

/**
 * A paragraph writes its lines with their starts protected, and an aligned
 * one as `<p align="…">` with HTML inside: markdown has no alignment. An
 * image alone on a line stays inside its paragraph.
 */
const NoteParagraph = Paragraph.extend<ParagraphOptions & BlockHtmlOptions>({
	addOptions() {
		return { ...(this.parent?.() as ParagraphOptions), inline_html: plain_inline_html }
	},
	parseMarkdown(token, helpers) {
		const tokens = token.tokens ?? []
		if (tokens.length === 1 && tokens[0]?.type === 'image') return helpers.createNode('paragraph', undefined, helpers.parseInline(tokens))
		return this.parent ? this.parent(token, helpers) : helpers.createNode('paragraph', undefined, helpers.parseInline(tokens))
	},
	renderMarkdown(node, h, ctx) {
		const align = node.attrs?.textAlign as string | null | undefined
		if (align) return aligned_html('p', this.options.inline_html(node.content ?? []), align)
		return protect_line_starts(this.parent ? this.parent(node, h, ctx) : h.renderChildren(node.content ?? []))
	},
})

/** All six levels, so `####` stays a heading; the popup offers the first three. */
const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const

const NoteHeading = Heading.extend<HeadingOptions & BlockHtmlOptions>({
	addOptions() {
		return { ...(this.parent?.() as HeadingOptions), levels: [...HEADING_LEVELS], inline_html: plain_inline_html }
	},
	renderMarkdown(node, h) {
		const level = Math.min(6, Math.max(1, Number(node.attrs?.level) || 1))
		const align = node.attrs?.textAlign as string | null | undefined
		if (align) return aligned_html(`h${level}`, this.options.inline_html(node.content ?? []), align)
		if (!node.content?.length) return ''
		return `${'#'.repeat(level)} ${protect_heading_end(h.renderChildren(node.content))}`
	},
})

/** A line break inside a paragraph is a plain newline (the app reads with `breaks`); a heading has one line. */
const NoteHardBreak = HardBreak.extend({
	renderMarkdown(_node, _h, ctx) {
		return ctx?.parentType === 'heading' ? '<br>' : '\n'
	},
})

/** The info string's first word, safe as an attribute value: the language of a fence. */
const fence_language = (value: unknown) => /^[\w+#.-]{1,40}/.exec(String(value ?? ''))?.[0] ?? null

/**
 * A code block reads any fence (Tiptap drops one indented by a few spaces),
 * marks its language with a data attribute rather than a class (a note may
 * not add classes to the app), and fences with more backticks than the code
 * holds, so a ``` line inside does not end it.
 */
const NoteCodeBlock = CodeBlock.extend({
	parseMarkdown(token, helpers) {
		const text = String(token.text ?? '')
		return helpers.createNode('codeBlock', { language: token.lang || null }, text ? [helpers.createTextNode(text)] : [])
	},
	renderHTML({ node, HTMLAttributes }) {
		return ['pre', HTMLAttributes, ['code', { 'data-language': fence_language(node.attrs.language) }, 0]]
	},
	renderMarkdown(node) {
		const text = (node.content ?? []).map(child => child.text ?? '').join('')
		const runs = [...text.matchAll(/^[ \t]*(`{3,})/gm)].map(match => match[1]!.length)
		const fence = '`'.repeat(Math.max(3, ...runs.map(n => n + 1)))
		return `${fence}${String(node.attrs?.language ?? '')}\n${text}\n${fence}`
	},
})

/**
 * Two lists of one kind next to each other would read back as one list:
 * markdown starts a new list only where the marker changes. The second one
 * takes the other marker (`*` for `-`, `1)` for `1.`). Only the lines at
 * column 0 are this list's own items; nested ones are indented.
 */
const NoteBulletList = BulletList.extend({
	renderMarkdown(node, h, ctx) {
		const out = this.parent ? this.parent(node, h, ctx) : h.renderChildren(node.content ?? [], '\n')
		return ctx?.previousNode?.type === 'bulletList' ? out.replace(/^- /gm, '* ') : out
	},
})

const NoteTaskList = TaskList.extend({
	renderMarkdown(node, h, ctx) {
		const out = this.parent ? this.parent(node, h, ctx) : h.renderChildren(node.content ?? [], '\n')
		return ctx?.previousNode?.type === 'taskList' ? out.replace(/^- \[/gm, '* [') : out
	},
})

/**
 * `1. [ ] x` is no task in this schema (Tiptap's tasks are bullets), but
 * marked takes the box out of the text as a token of its own, which Tiptap
 * drops. Put it back as text, so the item reads and writes as it was.
 */
function checkbox_as_text(item: MarkdownToken): MarkdownToken {
	if (!item.task) return item
	const box = (token: MarkdownToken): MarkdownToken => {
		const text = token.checked ? '[x] ' : '[ ] '
		return { type: 'text', raw: text, text }
	}
	const tokens = [...(item.tokens ?? [])]
	const first = tokens[0]
	if (first?.type === 'checkbox') {
		const next = tokens[1]
		if (next && (next.type === 'text' || next.type === 'paragraph') && next.tokens) tokens.splice(0, 2, { ...next, tokens: [box(first), ...next.tokens] })
		else tokens.splice(0, 1, { type: 'text', raw: '', text: '', tokens: [box(first)] })
	} else if (first?.type === 'paragraph' && first.tokens?.[0]?.type === 'checkbox') {
		tokens[0] = { ...first, tokens: [box(first.tokens[0]), ...first.tokens.slice(1)] }
	}
	return { ...item, tokens }
}

/**
 * Ordered lists are read by marked, as CommonMark has them. Tiptap's own
 * reader for them merges `1.` and `1)` lists into one and leaves a space at
 * the start of a continuation line (unsetting a field falls back to the
 * parent's, so this one never matches instead). Its items go through the
 * list item's own reader, as a bullet list's do: Tiptap's ordered one takes
 * a tight item's text whole and loses its line breaks.
 */
const NoteOrderedList = OrderedList.extend({
	markdownTokenizer: { name: 'orderedList', level: 'block', start: () => -1, tokenize: () => undefined },
	parseMarkdown(token, helpers) {
		if (token.type !== 'list' || !token.ordered) return []
		const start = Number(token.start) || 1
		const content = helpers.parseChildren((token.items ?? []).map(checkbox_as_text))
		return start === 1 ? { type: 'orderedList', content } : { type: 'orderedList', attrs: { start }, content }
	},
	renderMarkdown(node, h, ctx) {
		const out = this.parent ? this.parent(node, h, ctx) : h.renderChildren(node.content ?? [], '\n')
		return ctx?.previousNode?.type === 'orderedList' ? out.replace(/^(\d+)\. /gm, '$1) ') : out
	},
})

/** A table without the blank lines Tiptap puts around it. */
const NoteTable = Table.extend({
	renderMarkdown(node, h) {
		return renderTableToMarkdown(node, h).replace(/^\n+/, '').replace(/\n+$/, '')
	},
})

/** Paragraph and heading alignment; the default one is stored as null and never written. */
const Align = Extension.create<{ default_align: Align }>({
	name: 'textAlign',
	addOptions() {
		return { default_align: 'left' }
	},
	addGlobalAttributes() {
		return [{
			types: ['paragraph', 'heading'],
			attributes: {
				textAlign: {
					default: null,
					parseHTML: element => parse_align(element.getAttribute('align') || element.style.textAlign, this.options.default_align),
					renderHTML: attrs => attrs.textAlign ? { style: `text-align: ${attrs.textAlign}` } : {},
				},
			},
		}]
	},
})

const CALLOUT_LINE = /\n[ ]{0,3}(?:> ?\[![A-Za-z][\w-]*\]|<aside\b)/i
const CALLOUT_QUOTE = /^ {0,3}> ?\[!([A-Za-z][\w-]*)\]([^\n]*)(?:\n|$)((?:[ \t]{0,3}>[^\n]*(?:\n|$))*)/
const CALLOUT_ASIDE = /^ {0,3}<aside\b[^>]*>([\s\S]*?)<\/aside>[ \t]*(?:\n|$)/i

/**
 * A callout: `> [!NOTE]` as GitHub and Obsidian write it (any kind, with a
 * fold mark or a title after it), and Notion's `<aside>`, which is written
 * back as `> [!NOTE]`. `kind` keeps the word as written.
 */
const Callout = Node.create({
	name: 'callout',
	group: 'block',
	content: 'block+',
	defining: true,
	addAttributes() {
		return {
			kind: { default: 'NOTE', rendered: false },
			suffix: { default: '', rendered: false },
		}
	},
	parseHTML() {
		return [
			{ tag: 'aside', getAttrs: () => ({ kind: 'NOTE' }) },
			{ tag: 'div[data-callout]', getAttrs: element => ({ kind: ((element as HTMLElement).dataset.callout || 'note').toUpperCase() }) },
		]
	},
	renderHTML({ node }) {
		const kind = String(node.attrs.kind ?? 'note').toLowerCase().replace(/[^a-z0-9-]/g, '')
		return ['div', { 'data-callout': kind || 'note' }, 0]
	},
	markdownTokenizer: {
		name: 'callout',
		level: 'block',
		// Only where a line starts: marked cuts a paragraph at the index it gets.
		start: (src: string) => {
			const match = CALLOUT_LINE.exec(src)
			return match ? match.index + 1 : -1
		},
		tokenize: (src: string, _tokens: MarkdownToken[], lexer: MarkdownLexerConfiguration) => {
			const aside = CALLOUT_ASIDE.exec(src)
			if (aside) return { type: 'callout', raw: aside[0], kind: 'NOTE', suffix: '', tokens: lexer.blockTokens(aside[1]!.trim()) }
			const quote = CALLOUT_QUOTE.exec(src)
			if (!quote) return undefined
			const inner = quote[3]!.replace(/\n$/, '').split('\n').map(line => line.replace(/^[ \t]{0,3}> ?/, '')).join('\n')
			return { type: 'callout', raw: quote[0], kind: quote[1], suffix: quote[2], tokens: inner.trim() ? lexer.blockTokens(inner) : [] }
		},
	},
	parseMarkdown(token, helpers) {
		const content = helpers.parseChildren(token.tokens ?? [])
		return helpers.createNode('callout', { kind: token.kind, suffix: token.suffix ?? '' }, content.length ? content : [{ type: 'paragraph' }])
	},
	renderMarkdown(node, h) {
		const head = `> [!${node.attrs?.kind ?? 'NOTE'}]${node.attrs?.suffix ?? ''}`
		const inner = h.renderChildren(node.content ?? [], '\n\n')
		if (!inner.trim()) return head
		return head + '\n' + inner.split('\n').map(line => line.trim() ? `> ${line}` : '>').join('\n')
	},
})

/**
 * An HTML comment or an inline tag the schema does not know (`<kbd>`), kept
 * as written. It shows through `raw_html`, or not at all.
 */
const RawInline = Node.create<{ raw_html: ((raw: string, inline: boolean) => string) | null }>({
	name: 'rawInline',
	group: 'inline',
	inline: true,
	atom: true,
	selectable: true,
	addOptions() {
		return { raw_html: null }
	},
	addAttributes() {
		return {
			raw: {
				default: '',
				rendered: false,
				parseHTML: element => element.getAttribute('data-raw') ?? '',
			},
		}
	},
	parseHTML() {
		return [{ tag: 'span[data-raw-inline]' }]
	},
	renderHTML({ node }) {
		const raw = String(node.attrs.raw ?? '')
		const render = this.options.raw_html
		if (!render || typeof document === 'undefined' || raw.startsWith('<!--')) return ['span', { 'data-raw-inline': '', 'data-raw': raw }]
		const element = document.createElement('span')
		element.setAttribute('data-raw-inline', '')
		element.setAttribute('data-raw', raw)
		element.innerHTML = render(raw, true)
		return element
	},
	renderMarkdown(node) {
		return String(node.attrs?.raw ?? '')
	},
})

/**
 * `<details>` with blank lines inside (markdown in its body): the whole
 * element, up to its matching `</details>`, as one raw block. marked would
 * end the HTML at the first blank line and leave the body outside the box.
 */
const DETAILS_START = /\n {0,3}<details[\s>]/i
const DETAILS_OPEN = /^ {0,3}<details(?=[\s>])[^>]*>/i

function match_details(src: string): string | null {
	const open = DETAILS_OPEN.exec(src)
	if (!open) return null
	const tags = /<(\/?)details(?=[\s>])[^>]*>/gi
	tags.lastIndex = open[0].length
	let depth = 1
	for (let match = tags.exec(src); match; match = tags.exec(src)) {
		depth += match[1] ? -1 : 1
		if (depth > 0) continue
		const end = match.index + match[0].length
		const line_end = src.indexOf('\n', end)
		const rest = src.slice(end, line_end < 0 ? src.length : line_end)
		if (rest.trim()) return null
		return src.slice(0, line_end < 0 ? src.length : line_end + 1)
	}
	return null
}

/**
 * A block the schema does not know (HTML other than an aligned paragraph or
 * heading, front matter), kept as its source and written back unchanged. It
 * shows through `raw_html`; it cannot be edited inside the note.
 */
const RawBlock = Node.create<{ raw_html: ((raw: string, inline: boolean) => string) | null }>({
	name: 'rawBlock',
	group: 'block',
	atom: true,
	selectable: true,
	addOptions() {
		return { raw_html: null }
	},
	addAttributes() {
		return {
			raw: {
				default: '',
				rendered: false,
				parseHTML: element => element.getAttribute('data-raw') ?? '',
			},
		}
	},
	parseHTML() {
		return [{ tag: 'div[data-raw-block]' }]
	},
	renderHTML({ node }) {
		const raw = String(node.attrs.raw ?? '')
		const render = this.options.raw_html
		if (!render || typeof document === 'undefined') return ['div', { 'data-raw-block': '', 'data-raw': raw }, ['pre', {}, raw]]
		const element = document.createElement('div')
		element.setAttribute('data-raw-block', '')
		element.setAttribute('data-raw', raw)
		element.innerHTML = render(raw, false)
		return element
	},
	markdownTokenizer: {
		name: 'rawBlock',
		level: 'block',
		start: (src: string) => {
			const match = DETAILS_START.exec(src)
			return match ? match.index + 1 : -1
		},
		tokenize: (src: string) => {
			const raw = match_details(src)
			return raw ? { type: 'rawBlock', raw, text: raw } : undefined
		},
	},
	parseMarkdown(token, helpers) {
		return helpers.createNode('rawBlock', { raw: String(token.raw ?? '').replace(/\s+$/, '') })
	},
	renderMarkdown(node) {
		return String(node.attrs?.raw ?? '')
	},
})

export function note_extensions(options: NoteExtensionOptions = {}): AnyExtension[] {
	const default_align = options.default_align ?? 'left'
	const inline_html = options.inline_html ?? plain_inline_html
	return [
		StarterKit.configure({
			paragraph: false,
			heading: false,
			hardBreak: false,
			codeBlock: false,
			link: false,
			underline: false,
			bulletList: false,
			orderedList: false,
		}),
		NoteBulletList,
		NoteOrderedList,
		NoteParagraph.configure({ inline_html }),
		NoteHeading.configure({ inline_html }),
		NoteHardBreak,
		NoteCodeBlock,
		NoteLink.configure({ openOnClick: false, autolink: true, linkOnPaste: true, defaultProtocol: 'https' }),
		NoteImage.configure({ inline: true, allowBase64: true }),
		NoteUnderline,
		NoteTaskList,
		TaskItem.configure({ nested: true }),
		TableKit.configure({ table: false }),
		NoteTable.configure({ resizable: false }),
		TextColor,
		BgColor,
		Small,
		NoteSubscript,
		NoteSuperscript,
		Align.configure({ default_align }),
		Callout,
		RawBlock.configure({ raw_html: options.raw_html ?? null }),
		RawInline.configure({ raw_html: options.raw_html ?? null }),
	]
}

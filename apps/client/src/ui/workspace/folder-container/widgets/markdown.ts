import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { safeInlineStyle } from './safeInlineStyle'

marked.setOptions({ breaks: true })

// Notes come from shared and public folders, i.e. from other users, and their
// HTML lands in the app's own document. Besides scripts, a note must not be
// able to restyle or cover the app: no <style> (it applies to the whole page),
// no classes (the app's own utility classes would apply), and only text styling
// in `style` (safeInlineStyle). No <form> either: it could post what a visitor
// types to another site. The only link is an HTML <a>, which shows where it
// goes: no image map (<map>, <area>, `usemap`) and no address on an <a>
// inside <svg>, either of which can cover a whole note with a link nobody
// sees and take the window to another site on any click.
//
// Nothing to type into or press, either: a note is text, and a password field
// or a "Sign in" button drawn inside one looks like the app asking. The one
// control a note has is the checkbox of a task list (`uponSanitizeElement`
// below keeps an <input> only as that). The text inside a dropped element
// stays. Media starts when the reader starts it (`autoplay`), nothing takes
// the focus on its own (`autofocus`), and nothing carries a name the page
// could be looked up by (`id`, `name`): the app finds its own elements by id.
const NOTE_FORBID_TAGS = [
	'style', 'form', 'map', 'area',
	'textarea', 'select', 'option', 'optgroup', 'datalist', 'button', 'fieldset', 'legend', 'output',
]
const NOTE_FORBID_ATTR = ['class', 'usemap', 'id', 'name', 'autoplay', 'autofocus']

// `data-*` is how the app marks its own elements (`data-id`, `data-path`, a
// drop target, the window's drag region `data-tauri-drag-region`), and its
// handlers find them by walking up from whatever was clicked or dropped on.
// A note keeps only the marks its own rendering reads.
const NOTE_DATA_ATTRS: ReadonlySet<string> = new Set([
	'data-type', 'data-checked', 'data-callout', 'data-language', 'data-front-matter',
	'data-raw', 'data-raw-inline', 'data-raw-block', 'data-held-src', 'data-colwidth',
])

/** What stays on a task list's checkbox. */
const CHECKBOX_ATTRS: ReadonlySet<string> = new Set(['type', 'checked', 'disabled'])

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg'
const LINK_ATTRS: ReadonlySet<string> = new Set(['href', 'xlink:href'])

// DOMPurify needs a DOM; in the node test environment it exports a factory
// without `sanitize`. The app always runs in a webview, so the DOMPurify path
// is what ships — but returning marked's raw output when it is missing made
// the fallback no sanitizer at all. Strip the obvious script vectors instead,
// the same shape as regex_sanitize_svg in services/board/shapes.ts: a regex
// cannot be exhaustive, which is exactly why the browser uses DOMPurify.
//
// A separate instance: its `style` hook must not reach the SVG sanitizer in
// services/board/shapes.ts, where shape fills live in `style`.
function createNotePurify() {
	if (typeof window === 'undefined') return null
	const purify = DOMPurify(window)
	// A DOMPurify that finds the DOM lacking still has `sanitize`, and returns
	// its input untouched: take the fallback then.
	if (!purify.isSupported) return null
	purify.addHook('uponSanitizeElement', (node) => {
		if (!(node instanceof Element) || node.localName !== 'input') return
		if ((node.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') node.remove()
	})
	purify.addHook('uponSanitizeAttribute', (node, data) => {
		const name = data.attrName.toLowerCase()
		if (LINK_ATTRS.has(name) && node.namespaceURI === SVG_NAMESPACE && node.localName === 'a') {
			data.keepAttr = false
			return
		}
		if (name.startsWith('data-') && !NOTE_DATA_ATTRS.has(name)) {
			data.keepAttr = false
			return
		}
		if (node.localName === 'input' && !CHECKBOX_ATTRS.has(name)) {
			data.keepAttr = false
			return
		}
		if (data.attrName !== 'style') return
		const style = safeInlineStyle(data.attrValue)
		if (style) data.attrValue = style
		else data.keepAttr = false
	})
	return purify
}

const notePurify = createNotePurify()

const DANGEROUS_URL = /^\s*(javascript:|data:)/i

/** One start tag with its attributes; a quoted value may hold `>`. */
const START_TAG = /<[a-z][a-z0-9-]*(?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*\s*\/?>/gi

/** Inside a tag only: the same words in the note's text stay as they are. */
function fallbackSanitizeTag(tag: string): string {
	return tag
		.replace(/\s(?:class|id|name|autoplay|autofocus|data-[a-z0-9-]+)(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?(?=[\s/>])/gi, (attr) => {
			const name = attr.trim().split(/[\s=]/)[0]!.toLowerCase()
			return NOTE_DATA_ATTRS.has(name) ? attr : ''
		})
		.replace(
			/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
			(_match, double_q?: string, single_q?: string, bare?: string) => {
				const style = safeInlineStyle(double_q ?? single_q ?? bare ?? '')
				return style ? ` style="${style}"` : ''
			},
		)
}

function fallbackSanitize(html: string): string {
	return html
		.replace(/<script\b[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?>[\s\S]*?<\/style>/gi, '')
		.replace(/<\/?(?:form|map|area|textarea|select|option|optgroup|datalist|button|fieldset|legend|output)\b[^>]*>/gi, '')
		.replace(/<input\b(?![^>]*\stype\s*=\s*["']?checkbox)[^>]*>/gi, '')
		.replace(/\susemap\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(/<(?:iframe|embed|object|foreignObject)\b[\s\S]*?>[\s\S]*?<\/(?:iframe|embed|object|foreignObject)>/gi, '')
		.replace(/<(?:iframe|embed|object|foreignObject)\b[^>]*\/?>/gi, '')
		.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(
			/\s(?:href|xlink:href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
			(match, double_q?: string, single_q?: string, bare?: string) =>
				DANGEROUS_URL.test(double_q ?? single_q ?? bare ?? '') ? '' : match,
		)
		.replace(START_TAG, fallbackSanitizeTag)
}

// Notion writes a callout as <aside>…</aside>. marked keeps that as an HTML
// block and, when a list sits inside, parks the closing tag in the last <li>,
// so the preview never becomes one box. A line of markdown straight after
// <aside> is left raw until the next blank line. Parse the inside on its own
// and splice the finished element back once the rest of the note is parsed.
// One level only: a callout does not contain another callout.
const ASIDE_BLOCK = /<aside\b[^>]*>((?:(?!<\/?aside\b)[\s\S])*)<\/aside>/gi

function liftAsides(text: string): { source: string; blocks: string[] } {
	const blocks: string[] = []
	const source = text.replace(ASIDE_BLOCK, (_match, inner: string) => {
		const html = (marked.parse(inner.trim(), { async: false }) as string).trim()
		const token = `\uE000${blocks.length}\uE001`
		blocks.push(`<aside>${html}</aside>`)
		return `\n\n${token}\n\n`
	})
	return { source, blocks }
}

/** A note's HTML made safe for the app's document, whoever built it. */
export function sanitizeNoteHtml(html: string): string {
	if (!html) return ''
	return notePurify
		? notePurify.sanitize(html, { FORBID_TAGS: NOTE_FORBID_TAGS, FORBID_ATTR: NOTE_FORBID_ATTR })
		: fallbackSanitize(html)
}

export function parseNoteMarkdown(text: string): string {
	if (!text) return ''
	const { source, blocks } = liftAsides(text)
	let html = marked.parse(source, { async: false }) as string
	if (blocks.length) {
		html = html.replace(/<p>\uE000(\d+)\uE001<\/p>/g, (_match, index: string) => {
			return blocks[Number(index)] ?? ''
		})
	}
	return sanitizeNoteHtml(html)
}

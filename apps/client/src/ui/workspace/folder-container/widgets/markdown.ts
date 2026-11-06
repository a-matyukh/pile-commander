import { marked } from 'marked'
import DOMPurify from 'dompurify'
import { safeInlineStyle } from './safeInlineStyle'

marked.setOptions({ breaks: true })

// Notes come from shared and public folders, i.e. from other users, and their
// HTML lands in the app's own document. Besides scripts, a note must not be
// able to restyle or cover the app: no <style> (it applies to the whole page),
// no classes (the app's own utility classes would apply), and only text styling
// in `style` (safeInlineStyle). No <form> either: it could post what a visitor
// types to another site.
const NOTE_FORBID_TAGS = ['style', 'form']
const NOTE_FORBID_ATTR = ['class']

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
	purify.addHook('uponSanitizeAttribute', (_node, data) => {
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
		.replace(/\sclass\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
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
		.replace(/<\/?form\b[^>]*>/gi, '')
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

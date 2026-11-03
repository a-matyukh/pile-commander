import { marked } from 'marked'
import DOMPurify from 'dompurify'

marked.setOptions({ breaks: true })

// DOMPurify needs a DOM; in the node test environment it exports a factory
// without `sanitize`. The app always runs in a webview, so the DOMPurify path
// is what ships — but returning marked's raw output when it is missing made
// the fallback no sanitizer at all. Strip the obvious script vectors instead,
// the same shape as regex_sanitize_svg in services/board/shapes.ts: a regex
// cannot be exhaustive, which is exactly why the browser uses DOMPurify.
const canSanitize = typeof DOMPurify.sanitize === 'function'

const DANGEROUS_URL = /^\s*(javascript:|data:)/i

function fallbackSanitize(html: string): string {
	return html
		.replace(/<script\b[\s\S]*?>[\s\S]*?<\/script>/gi, '')
		.replace(/<(?:iframe|embed|object|foreignObject)\b[\s\S]*?>[\s\S]*?<\/(?:iframe|embed|object|foreignObject)>/gi, '')
		.replace(/<(?:iframe|embed|object|foreignObject)\b[^>]*\/?>/gi, '')
		.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
		.replace(
			/\s(?:href|xlink:href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
			(match, double_q?: string, single_q?: string, bare?: string) =>
				DANGEROUS_URL.test(double_q ?? single_q ?? bare ?? '') ? '' : match,
		)
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

export function parseNoteMarkdown(text: string): string {
	if (!text) return ''
	const { source, blocks } = liftAsides(text)
	let html = marked.parse(source, { async: false }) as string
	if (blocks.length) {
		html = html.replace(/<p>\uE000(\d+)\uE001<\/p>/g, (_match, index: string) => {
			return blocks[Number(index)] ?? ''
		})
	}
	return canSanitize ? DOMPurify.sanitize(html) : fallbackSanitize(html)
}

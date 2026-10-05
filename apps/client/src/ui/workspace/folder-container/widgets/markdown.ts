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

export function parseNoteMarkdown(text: string): string {
	if (!text) return ''
	const html = marked.parse(text, { async: false }) as string
	return canSanitize ? DOMPurify.sanitize(html) : fallbackSanitize(html)
}

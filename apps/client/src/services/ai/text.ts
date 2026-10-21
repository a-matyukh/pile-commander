/**
 * Drops the reasoning some models (qwen3, deepseek-r1) write into the answer
 * itself as `<think>…</think>`. A block still open at the end, a model that
 * is still thinking or was cut off, is dropped to the end of the text.
 * Run this before `untrusted_markdown`: once `<` is escaped, the block can
 * no longer be recognized.
 */
export function strip_think(text: string): string {
	return text
		.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
		.replace(/<(think|thinking)>[\s\S]*$/i, '')
		.trim()
}

/**
 * Model text is untrusted, and a summary has no use for HTML. Every `<` is
 * escaped, so marked shows any tag as text: a `video` poster, a `picture`
 * source, a CSS background, an unclosed tag at the end of a stream. Markdown
 * images (`![alt](url)`, `![alt][id]`, and the shortcut `![alt]`) become
 * their alt text, because those load a remote address on render. Links stay:
 * they load only on a click. Inside `` `code` `` the escaped form shows as
 * `&lt;`, which is fine for a summary.
 */
export function untrusted_markdown(text: string): string {
	let current = text.replace(/</g, '&lt;')
	for (let pass = 0; pass < 5; pass++) {
		const next = strip_shortcut_images(strip_ref_images(replace_markdown_images(current)))
		if (next === current) return current.trim()
		current = next
	}
	return current.trim()
}

/**
 * Inline `![alt](url)`, including a url with balanced parentheses and one
 * left unclosed at the end of the text (a stream that has not finished the
 * image yet). Reference images are left for the pass after this one.
 */
function replace_markdown_images(text: string): string {
	let out = ''
	let at = 0
	while (at < text.length) {
		const start = text.indexOf('![', at)
		if (start === -1) return out + text.slice(at)
		out += text.slice(at, start)
		const alt_end = text.indexOf(']', start + 2)
		if (alt_end === -1) return out + text.slice(start)
		const alt = text.slice(start + 2, alt_end)
		if (text[alt_end + 1] !== '(') {
			out += text[start]!
			at = start + 1
			continue
		}
		let cursor = alt_end + 2
		let depth = 1
		while (cursor < text.length && depth > 0) {
			const ch = text[cursor]!
			if (ch === '\n') break
			if (ch === '(') depth++
			else if (ch === ')') depth--
			cursor++
		}
		if (depth !== 0) {
			if (!text.slice(start).includes('\n')) return out + alt
			out += text[start]!
			at = start + 1
			continue
		}
		out += alt
		at = cursor
	}
	return out
}

function strip_ref_images(text: string): string {
	return text.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
}

/** `![alt]` names a link definition and renders as an image too. */
function strip_shortcut_images(text: string): string {
	return text.replace(/!\[([^\]]*)\](?!\s*[([])/g, '$1')
}

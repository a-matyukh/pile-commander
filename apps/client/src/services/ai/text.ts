/**
 * Drops the reasoning some models (qwen3, deepseek-r1) write into the answer
 * itself as `<think>…</think>`. A block still open at the end, a model that
 * is still thinking or was cut off, is dropped to the end of the text.
 */
export function strip_think(text: string): string {
	return text
		.replace(/<(think|thinking)>[\s\S]*?<\/\1>/gi, '')
		.replace(/<(think|thinking)>[\s\S]*$/i, '')
		.trim()
}

const LOCAL_IMAGE_URL = /^(?:data|blob):/i

/**
 * Model text is untrusted: a note can ask the model to embed a remote image
 * whose address carries the summary. The preview and, after Accept, the
 * board would load it — CSP allows `https` images, and the desktop webview
 * has no CSP. Markdown images that are not `data:` or `blob:` become their
 * alt text. An `<img>` that would load anything else is removed. Links stay,
 * since they load only on click.
 */
export function strip_remote_images(text: string): string {
	let current = text
	for (let pass = 0; pass < 5; pass++) {
		const next = strip_img_tags(strip_shortcut_images(strip_ref_images(replace_markdown_images(current))))
		if (next === current) return current.trim()
		current = next
	}
	return current.trim()
}

function decode_entities(value: string): string {
	let current = value
	for (let pass = 0; pass < 3; pass++) {
		const next = current
			.replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => from_code(Number.parseInt(hex, 16)))
			.replace(/&#(\d+);?/g, (_, dec: string) => from_code(Number(dec)))
			.replace(/&colon;/gi, ':')
			.replace(/&sol;/gi, '/')
			.replace(/&quot;/gi, '"')
			.replace(/&apos;/gi, "'")
			.replace(/&amp;/gi, '&')
		if (next === current) break
		current = next
	}
	return current
}

function from_code(code: number): string {
	if (!Number.isInteger(code) || code < 0 || code > 0x10ffff) return ''
	return String.fromCodePoint(code)
}

function is_local_image_url(url: string): boolean {
	return LOCAL_IMAGE_URL.test(decode_entities(url).trim())
}

/** The URL of a markdown image destination, without a following title. */
function destination_url(inside: string): string {
	const trimmed = inside.trim()
	if (trimmed.startsWith('<')) {
		const end = trimmed.indexOf('>')
		return (end === -1 ? trimmed.slice(1) : trimmed.slice(1, end)).trim()
	}
	let at = 0
	let depth = 0
	while (at < trimmed.length) {
		const ch = trimmed[at]!
		if (ch === '(') depth++
		else if (ch === ')') depth = Math.max(0, depth - 1)
		else if (/\s/.test(ch) && depth === 0) break
		at++
	}
	return trimmed.slice(0, at)
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
		const url = destination_url(text.slice(alt_end + 2, cursor - 1))
		out += is_local_image_url(url) ? text.slice(start, cursor) : alt
		at = cursor
	}
	return out
}

function strip_ref_images(text: string): string {
	return text.replace(/!\[([^\]]*)\]\[[^\]]*\]/g, '$1')
}

function strip_shortcut_images(text: string): string {
	return text.replace(/!\[([^\]]*)\](?!\s*[([])/g, '$1')
}

function attr_values(tag: string, name: string): string[] {
	const values: string[] = []
	const pattern = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'gi')
	for (const match of tag.matchAll(pattern)) values.push(match[1] ?? match[2] ?? match[3] ?? '')
	return values
}

function srcset_urls(value: string): string[] {
	return value.split(',').map(part => part.trim().split(/\s+/)[0] ?? '').filter(Boolean)
}

function img_tag_is_safe(tag: string): boolean {
	const urls = [
		...attr_values(tag, 'src'),
		...attr_values(tag, 'srcset').flatMap(srcset_urls),
	]
	return urls.every(is_local_image_url)
}

function strip_img_tags(text: string): string {
	const closed = text.replace(/<img\b(?:[^>"']|"[^"]*"|'[^']*')*>/gi, tag => (img_tag_is_safe(tag) ? tag : ''))
	// A stream can end inside the tag, before `>`. An unclosed `<img` is not
	// left for the HTML parser to finish and load.
	return closed.replace(/<img\b[^>]*$/i, '')
}

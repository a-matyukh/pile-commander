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
 * The first JSON object in a model answer, or null. The reasoning block is
 * dropped first and a fenced block (```json) is tried before the rest, so
 * prose around the answer does not matter. A brace inside a string does not
 * end the object; an object that does not parse is passed over.
 */
export function extract_json(text: string): unknown {
	const clean = strip_think(text)
	const fence = /```(?:json)?[^\S\n]*\n?([\s\S]*?)```/i.exec(clean)
	for (const candidate of fence ? [fence[1]!, clean] : [clean]) {
		const found = first_object(candidate)
		if (found !== undefined) return found
	}
	return null
}

/** A balanced `{…}` that parses, from the first one that does. */
function first_object(text: string): unknown {
	for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
		let depth = 0
		let in_string = false
		let escaped = false
		for (let at = start; at < text.length; at++) {
			const ch = text[at]
			if (in_string) {
				if (escaped) escaped = false
				else if (ch === '\\') escaped = true
				else if (ch === '"') in_string = false
				continue
			}
			if (ch === '"') in_string = true
			else if (ch === '{') depth++
			else if (ch === '}' && --depth === 0) {
				try {
					return JSON.parse(text.slice(start, at + 1))
				} catch {
					break
				}
			}
		}
	}
	return undefined
}

/**
 * Model text is untrusted, and a summary has no use for HTML. Every `<` is
 * escaped, so marked shows any tag as text: a `video` poster, a `picture`
 * source, a CSS background, an unclosed tag at the end of a stream. Markdown
 * images (`![alt](url)`, `![alt][id]`, and the shortcut `![alt]`) become
 * their alt text, because those load a remote address on render. A link
 * loads only on a click, but its words can say one thing and its address
 * another ("Sign in" over someone's page): a link is written out with its
 * address, `Sign in (https://…)`, so the person sees where it goes in the
 * preview and in the saved note. Inside `` `code` `` the escaped form shows
 * as `&lt;`, which is fine for a summary.
 */
export function untrusted_markdown(text: string): string {
	let current = text.replace(/</g, '&lt;')
	for (let pass = 0; pass < 5; pass++) {
		const next = show_link_addresses(strip_shortcut_images(strip_ref_images(replace_markdown_images(current))))
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

/** The address of `[words](address "title")`, without the title and the angle brackets (escaped by now). */
function link_address(inside: string): string {
	let address = inside.trim()
	const title = /^(\S+)\s+(?:"[^"]*"|'[^']*'|\([^)]*\))$/.exec(address)
	if (title) address = title[1]!
	const angled = /^&lt;(.*)>$/.exec(address)
	return (angled ? angled[1]! : address).trim()
}

/**
 * `[words](address)` → `words (address)`, or the address alone when the
 * words are the address. A link by reference (`[words][id]` with `[id]:
 * address` elsewhere) loses its link: the words stay, and the definition
 * line, which markdown would hide, is left as text.
 */
function show_link_addresses(text: string): string {
	let out = ''
	let at = 0
	const opening = /\[([^[\]\n]*)\]\(/g
	for (let match = opening.exec(text); match; match = opening.exec(text)) {
		let cursor = match.index + match[0].length
		let depth = 1
		while (cursor < text.length && depth > 0) {
			const ch = text[cursor]!
			if (ch === '\n') break
			if (ch === '(') depth++
			else if (ch === ')') depth--
			cursor++
		}
		if (depth !== 0) continue
		const words = match[1]!.trim()
		const address = link_address(text.slice(match.index + match[0].length, cursor - 1))
		out += text.slice(at, match.index)
		out += !address ? words : !words || words === address ? address : `${words} (${address})`
		at = cursor
		opening.lastIndex = cursor
	}
	return (out + text.slice(at))
		.replace(/\[([^[\]\n]+)\]\[[^\]\n]*\]/g, '$1')
		.replace(/^( {0,3})\[([^\]\n]+)\]:/gm, '$1\\[$2]:')
}

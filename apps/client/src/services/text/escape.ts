/**
 * Text written into a note's markdown gets a backslash or an entity only where
 * the file would read differently without one. Tiptap's own writer escapes
 * every `\ * _ [ ] ~` and turns `& < >` into entities, which makes an ordinary
 * note (`Note_1`, `a < b`) hard to read in any other editor.
 */

const ESCAPABLE = /[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~]/
const WORD = /[\p{L}\p{N}]/u
const SPACE = /\s/

const is_word = (ch: string | undefined) => ch !== undefined && WORD.test(ch)
const is_space = (ch: string | undefined) => ch === undefined || SPACE.test(ch)

/** Another `ch` elsewhere in the run. (`lastIndexOf` from -1 would find the one at 0.) */
const has_other = (text: string, ch: string, i: number) => text.indexOf(ch, i + 1) >= 0 || (i > 0 && text.lastIndexOf(ch, i - 1) >= 0)

/**
 * Escapes one text run. `*` and `_` stay bare when they cannot open or close
 * emphasis (between spaces, or `_` inside a word); a backtick or `~` only when
 * another one in the run could pair with it; `[` only when it could start a
 * link or a reference; `<` and `&` only when they could start a tag or an
 * entity. A run is one text node, so a pair split across two nodes with
 * different marks is not seen; the round-trip tests cover the common shapes.
 * Inside a link's text every bracket is escaped: a bare `]` would end it.
 */
export function minimal_escape(text: string, in_link = false): string {
	let out = ''
	for (let i = 0; i < text.length; i++) {
		const ch = text[i]!
		const prev = text[i - 1]
		const next = text[i + 1]
		if (ch === '\\') out += next !== undefined && ESCAPABLE.test(next) ? '\\\\' : '\\'
		else if (ch === '*') out += is_space(prev) && is_space(next) ? '*' : '\\*'
		else if (ch === '_') out += (is_word(prev) && is_word(next)) || (is_space(prev) && is_space(next)) ? '_' : '\\_'
		else if (ch === '`') out += has_other(text, '`', i) ? '\\`' : '`'
		else if (ch === '~') out += has_other(text, '~', i) ? '\\~' : '~'
		else if (in_link && (ch === '[' || ch === ']')) out += '\\' + ch
		else if (ch === '[') out += /^[^\]]*\]\s*[([:]/.test(text.slice(i + 1)) ? '\\[' : '['
		else if (ch === '<') out += next !== undefined && /[a-z/!?]/i.test(next) ? '&lt;' : '<'
		else if (ch === '&') out += /^&#?[a-z0-9]+;/i.test(text.slice(i)) ? '&amp;' : '&'
		else out += ch
	}
	return out
}

/**
 * The lines of one paragraph, made safe at their start. A line that would
 * open a block when the file is read again (a heading, a list item, a quote, a
 * setext underline) gets a backslash; leading whitespace becomes an entity,
 * so markdown neither strips it nor reads the line as code. That is how a Tab
 * at the start of a line survives (`&#9;`). A leading `[ ]` stays as is: in
 * `1. [ ] x` it is text here and a checkbox on GitHub, and only a bullet item
 * could turn it into a task.
 */
export function protect_line_starts(markdown: string): string {
	return markdown.split('\n').map((line) => {
		if (line.startsWith('\t')) return '&#9;' + line.slice(1)
		if (line.startsWith(' ')) return '&#32;' + line.slice(1)
		return line
			.replace(/^(\d{1,9})([.)])(?=[ \t]|$)/, '$1\\$2')
			.replace(/^(#{1,6})(?=[ \t]|$)/, '\\$1')
			.replace(/^([-+*])(?=[ \t]|$)/, '\\$1')
			.replace(/^>/, '\\>')
			.replace(/^(=+|-+)([ \t]*)$/, '\\$1$2')
	}).join('\n')
}

/** A heading's text that ends in ` #` would lose it: markdown reads that as a closing sequence. */
export function protect_heading_end(markdown: string): string {
	return markdown.replace(/(^|[ \t])(#+)([ \t]*)$/, '$1\\$2$3')
}

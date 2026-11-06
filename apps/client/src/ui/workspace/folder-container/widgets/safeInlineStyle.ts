/**
 * The inline styles a note keeps. Notes come from other users (shared and
 * public folders) and their HTML lands in the app's own document, so `style`
 * keeps only text styling: colors, alignment, weight, slant and decoration.
 * Layout (position, size, margins, z-index, display), url(), expression() and
 * CSS escapes never pass: a note could otherwise cover or restyle the app.
 * Anything not on the list is dropped, one declaration at a time.
 */

/** A hex color, rgb()/hsl() with plain numbers (no nested function), or a keyword. */
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgba?|hsla?)\([0-9a-z.,%\s/+-]*\)|[a-z]+)$/i
const DECORATION = /^(?:none|(?:underline|line-through|overline)(?:\s+(?:underline|line-through|overline))*)$/i

const ALLOWED = new Map<string, RegExp>([
	['color', COLOR],
	['background-color', COLOR],
	// Only a plain color: an image would load from wherever the note points.
	['background', COLOR],
	['text-align', /^(?:left|right|center|justify|start|end)$/i],
	['font-weight', /^(?:normal|bold|bolder|lighter|[1-9]00)$/i],
	['font-style', /^(?:normal|italic|oblique)$/i],
	['text-decoration', DECORATION],
	['text-decoration-line', DECORATION],
])

export function safeInlineStyle(style: string): string {
	const kept: string[] = []
	for (const declaration of style.split(';')) {
		const colon = declaration.indexOf(':')
		if (colon < 0) continue
		const property = declaration.slice(0, colon).trim().toLowerCase()
		const value = declaration.slice(colon + 1).trim()
		if (ALLOWED.get(property)?.test(value)) kept.push(`${property}: ${value}`)
	}
	return kept.join('; ')
}

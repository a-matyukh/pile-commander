/**
 * The colors a note may carry: the palette the formatting popup offers.
 * Reading a note keeps a color only when it is one of these, so a note from a
 * shared or public folder cannot paint arbitrary colors. Tuned for the light
 * theme; there is no dark variant yet.
 */
export type PaletteColor = { id: string; hex: string }

export const TEXT_COLORS: readonly PaletteColor[] = [
	{ id: 'gray', hex: '#6b6a65' },
	{ id: 'brown', hex: '#8a5a3c' },
	{ id: 'orange', hex: '#c2571a' },
	{ id: 'yellow', hex: '#a87a00' },
	{ id: 'green', hex: '#3b7a1e' },
	{ id: 'blue', hex: '#1f6fc0' },
	{ id: 'purple', hex: '#6a4fc4' },
	{ id: 'pink', hex: '#b83e7a' },
	{ id: 'red', hex: '#c53a33' },
]

export const BG_COLORS: readonly PaletteColor[] = [
	{ id: 'gray', hex: '#eeede9' },
	{ id: 'brown', hex: '#f3e8df' },
	{ id: 'orange', hex: '#fde3cf' },
	{ id: 'yellow', hex: '#fff0a0' },
	{ id: 'green', hex: '#dff1d4' },
	{ id: 'blue', hex: '#d9e9fb' },
	{ id: 'purple', hex: '#e8e1fb' },
	{ id: 'pink', hex: '#fbe0ec' },
	{ id: 'red', hex: '#fddcd9' },
]

/** A bare `<mark>` reads as the yellow highlighter. */
export const DEFAULT_BG = '#fff0a0'

const TEXT_SET = new Set(TEXT_COLORS.map(c => c.hex))
const BG_SET = new Set(BG_COLORS.map(c => c.hex))

export function is_text_color(hex: string | null): hex is string {
	return hex !== null && TEXT_SET.has(hex)
}

export function is_bg_color(hex: string | null): hex is string {
	return hex !== null && BG_SET.has(hex)
}

/**
 * `#rgb`, `#rrggbb` or `rgb()` as a browser reports a style, to lower-case
 * `#rrggbb`. Anything else is null.
 */
export function normalize_hex(raw: string | null | undefined): string | null {
	const value = String(raw ?? '').trim().toLowerCase()
	if (/^#[0-9a-f]{6}$/.test(value)) return value
	const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(value)
	if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`
	const rgb = /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*1(?:\.0+)?\s*)?\)$/.exec(value)
	if (!rgb) return null
	const parts = [rgb[1], rgb[2], rgb[3]].map(Number)
	if (parts.some(n => n > 255)) return null
	return '#' + parts.map(n => n.toString(16).padStart(2, '0')).join('')
}

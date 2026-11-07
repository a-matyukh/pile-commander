/**
 * Text on a shape (stage 4 of the text plan in pile-commander-product, prototype P3): where it
 * sits inside the shape and what colour it takes on its fill.
 */

export type ShapeTextKind = 'rect' | 'ellipse' | 'triangle' | 'diamond'
export type ShapeTextArea = 'inset' | 'frame'

/** The shape an SVG draws, as far as its text cares: anything else is a box. */
export function shape_text_kind(svg: string): ShapeTextKind {
	if (/<(?:ellipse|circle)\b/i.test(svg)) return 'ellipse'
	const polygon = /<polygon\b[^>]*\bpoints\s*=\s*["']([^"']+)["']/i.exec(svg)
	if (polygon) {
		const corners = polygon[1]!.trim().split(/[\s,]+/).length / 2
		if (corners === 3) return 'triangle'
		if (corners === 4) return 'diamond'
	}
	return 'rect'
}

/**
 * The text's box as fractions of the shape's [top, right, bottom, left]:
 * inside the shape by default (the area inscribed in it), or the whole
 * frame with a small margin.
 */
export const SHAPE_TEXT_INSETS: Record<ShapeTextArea, Record<ShapeTextKind, [number, number, number, number]>> = {
	inset: {
		rect: [0.06, 0.06, 0.06, 0.06],
		ellipse: [0.15, 0.15, 0.15, 0.15],
		diamond: [0.25, 0.25, 0.25, 0.25],
		triangle: [0.46, 0.24, 0.05, 0.24],
	},
	frame: {
		rect: [0.06, 0.06, 0.06, 0.06],
		ellipse: [0.06, 0.06, 0.06, 0.06],
		diamond: [0.06, 0.06, 0.06, 0.06],
		triangle: [0.06, 0.06, 0.06, 0.06],
	},
}

/** A rectangle's two areas are the same: it has no switch. */
export function has_text_area_switch(kind: ShapeTextKind): boolean {
	return kind !== 'rect'
}

const DARK_TEXT = '#1f1f1e'
const LIGHT_TEXT = '#ffffff'

/** Text on a fill: white on a dark one, dark on a light one (and when the fill is unknown). */
export function shape_text_color(fill: string | undefined): string {
	const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(fill ?? '').trim())?.[1]
	if (!hex) return DARK_TEXT
	const full = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex
	const [r, g, b] = [0, 2, 4].map(i => parseInt(full.slice(i, i + 2), 16) / 255)
		.map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
	const luminance = 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
	return luminance < 0.4 ? LIGHT_TEXT : DARK_TEXT
}

import DOMPurify from 'dompurify'
import type { ShapeTemplate } from '@/domain/shapes'
import type { Position, Size } from '@/domain/Widget'
import { SHAPE_LINE_DEFAULT_SIZE } from './layout'

export const SHAPE_DEFAULT_FILL = '#6366f1'
export const SHAPE_LINE_DEFAULT_STROKE = '#4338ca'
export const LINE_STROKE_WIDTH = 6
/** Minimum AABB extent so the widget stays hittable when endpoints nearly coincide. */
export const LINE_MIN_EXTENT = 8
export const LINE_ARROW_SIZE = 14
/** Invisible hit-target stroke so the line is easy to grab without a full AABB. */
export const LINE_HIT_STROKE_WIDTH = 28
/** Treat endpoints as axis-aligned when the delta on that axis is within this epsilon. */
export const LINE_AXIS_EPS = 0.5
/**
 * Leaving the axis-aligned state needs a larger delta than entering it.
 * Hysteresis stops the h/d axis flip-flop (fixed-endpoint jitter) when the
 * dragged endpoint hovers within LINE_AXIS_EPS of horizontal/vertical.
 */
export const LINE_AXIS_RELEASE_EPS = 2

export type LinePlug = 'none' | 'arrow'
/** `h`/`v` = straight through box mid; `d` = corner-to-corner diagonal. */
export type LineAxis = 'h' | 'v' | 'd'

export type LineShapeMeta = {
	width: number
	height: number
	flipX: boolean
	flipY: boolean
	axis: LineAxis
	startPlug: LinePlug
	endPlug: LinePlug
	color: string
	strokeWidth: number
}

export function shape_template_svg(template: ShapeTemplate): string {
	switch (template) {
		case 'rect':
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${SHAPE_DEFAULT_FILL}"/></svg>`
		case 'ellipse':
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><ellipse cx="50" cy="50" rx="48.5" ry="48.5" fill="${SHAPE_DEFAULT_FILL}"/></svg>`
		case 'triangle':
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,2 98,98 2,98" fill="${SHAPE_DEFAULT_FILL}"/></svg>`
		case 'diamond':
			return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><polygon points="50,2 98,50 50,98 2,50" fill="${SHAPE_DEFAULT_FILL}"/></svg>`
		case 'line':
			return build_line_svg({
				width: SHAPE_LINE_DEFAULT_SIZE.width,
				height: SHAPE_LINE_DEFAULT_SIZE.height,
				flipX: false,
				flipY: false,
				axis: 'h',
				startPlug: 'none',
				endPlug: 'arrow',
				color: SHAPE_LINE_DEFAULT_STROKE,
				strokeWidth: LINE_STROKE_WIDTH,
			})
	}
}

/** True for dedicated line/arrow shapes (incl. legacy mid-line SVGs). */
export function is_line_shape(svg: string): boolean {
	if (/data-pc-line\s*=\s*["']?1["']?/i.test(svg)) return true
	return /<line\b/i.test(svg) && !/<(?:rect|ellipse|circle|polygon|path)\b/i.test(svg)
}

function parse_plug(value: string | undefined): LinePlug {
	return value === 'arrow' ? 'arrow' : 'none'
}

function attr(svg: string, name: string): string | undefined {
	const re = new RegExp(`\\s${name}\\s*=\\s*["']([^"']*)["']`, 'i')
	return svg.match(re)?.[1]
}

const PAINTABLE_ELEMENT_RE = /<(path|rect|ellipse|circle|polygon|polyline)\b[^>]*\/?>/gi

/** Reads `fill:` from a tag's inline style attribute, if present. */
function read_style_fill(tag: string): string | undefined {
	const style = attr(tag, 'style')
	return style?.match(/(?:^|;)\s*fill\s*:\s*([^;]+)/i)?.[1]?.trim()
}

/** Colors that Fill should leave untouched (background rects, masks, etc.). */
function is_recolorable_fill(fill: string): boolean {
	const value = fill.trim().toLowerCase()
	return value !== '' && value !== 'none' && value !== 'transparent' && value !== 'currentcolor'
}

/** Replaces an attribute on a single tag (either quote style) or appends it. */
function set_attr_on_tag(tag: string, name: string, value: string): string {
	const re = new RegExp(`(\\s${name}\\s*=\\s*)("[^"]*"|'[^']*')`, 'i')
	if (re.test(tag)) {
		return tag.replace(re, `$1"${value}"`)
	}
	return tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`)
}

/** Rewrites or appends `fill:` inside a tag's inline style, if it has one. */
function set_style_fill(tag: string, color: string): string {
	const style = attr(tag, 'style')
	if (style === undefined) return tag
	const next = /fill\s*:/i.test(style)
		? style.replace(/(fill\s*:\s*)[^;]+/i, `$1${color}`)
		: `${style.replace(/[\s;]+$/, '')};fill:${color}`
	return set_attr_on_tag(tag, 'style', next)
}

function parse_bool_flag(value: string | undefined): boolean {
	return value === '1' || value === 'true'
}

function parse_axis(
	value: string | undefined,
	width: number,
	height: number,
): LineAxis {
	if (value === 'h' || value === 'v' || value === 'd') return value
	// SVGs from before data-axis: flat boxes were horizontal templates.
	if (height <= LINE_MIN_EXTENT * 1.5) return 'h'
	if (width <= LINE_MIN_EXTENT * 1.5) return 'v'
	return 'd'
}

function local_endpoints(
	width: number,
	height: number,
	flipX: boolean,
	flipY: boolean,
	axis: LineAxis,
): {
	start: Position
	end: Position
} {
	if (axis === 'h') {
		const y = height / 2
		return {
			start: { x: flipX ? width : 0, y },
			end: { x: flipX ? 0 : width, y },
		}
	}
	if (axis === 'v') {
		const x = width / 2
		return {
			start: { x, y: flipY ? height : 0 },
			end: { x, y: flipY ? 0 : height },
		}
	}
	return {
		start: {
			x: flipX ? width : 0,
			y: flipY ? height : 0,
		},
		end: {
			x: flipX ? 0 : width,
			y: flipY ? 0 : height,
		},
	}
}

/** Absolute board/canvas coordinates of the line endpoints. */
export function absolute_line_endpoints(
	position: Position,
	size: Size,
	flipX: boolean,
	flipY: boolean,
	axis: LineAxis = 'd',
): { start: Position; end: Position } {
	const local = local_endpoints(size.width, size.height, flipX, flipY, axis)
	return {
		start: { x: position.x + local.start.x, y: position.y + local.start.y },
		end: { x: position.x + local.end.x, y: position.y + local.end.y },
	}
}

export type LineLayout = {
	position: Position
	size: Size
	flipX: boolean
	flipY: boolean
	axis: LineAxis
}

export type LineLayoutAnchor = {
	/** Absolute coordinates of the endpoint that must stay put. */
	point: Position
	/** Which endpoint `point` corresponds to. */
	which: 'start' | 'end'
}

/** tan(22.5°) — half the 45° sector used to pick the nearest strict direction. */
const ANGLE_SNAP_TAN = Math.tan(Math.PI / 8)

/**
 * Shift-drag constraint (Milanote/Figma style): snap the moved endpoint so the
 * line runs exactly horizontal, vertical, or at 45° — whichever sector the raw
 * delta falls into. The 45° case projects the delta onto the diagonal so the
 * line length tracks the cursor along that direction.
 */
export function constrain_line_angle(fixed: Position, moved: Position): Position {
	const dx = moved.x - fixed.x
	const dy = moved.y - fixed.y
	const adx = Math.abs(dx)
	const ady = Math.abs(dy)
	if (adx === 0 && ady === 0) return { ...fixed }
	if (ady <= adx * ANGLE_SNAP_TAN) return { x: moved.x, y: fixed.y }
	if (adx <= ady * ANGLE_SNAP_TAN) return { x: fixed.x, y: moved.y }
	const component = (adx + ady) / 2
	return {
		x: fixed.x + Math.sign(dx) * component,
		y: fixed.y + Math.sign(dy) * component,
	}
}

/** Derive AABB + flips + axis from two absolute endpoints (with minimum extent). */
export function line_layout_from_endpoints(
	start: Position,
	end: Position,
	prevAxis?: LineAxis,
	/**
	 * The endpoint that must stay put while the other one drags.
	 * Axis-aligned lines pass through it exactly, and the min-extent padding
	 * grows away from it — so the fixed endpoint never shifts or jumps.
	 */
	anchor?: LineLayoutAnchor,
): LineLayout {
	const dx = Math.abs(end.x - start.x)
	const dy = Math.abs(end.y - start.y)
	const flipX = start.x > end.x
	const flipY = start.y > end.y

	const horizontal = dy <= (prevAxis === 'h' ? LINE_AXIS_RELEASE_EPS : LINE_AXIS_EPS)
	const vertical = dx <= (prevAxis === 'v' ? LINE_AXIS_RELEASE_EPS : LINE_AXIS_EPS)

	const axis: LineAxis = horizontal
		? 'h'
		: vertical
			? 'v'
			: 'd'

	if (axis === 'h') {
		const midY = anchor?.point.y ?? (start.y + end.y) / 2
		const width = Math.max(dx, LINE_MIN_EXTENT)
		const height = LINE_MIN_EXTENT
		const left = dx < LINE_MIN_EXTENT
			? anchor
				? anchor.point.x - ((anchor.which === 'start' ? flipX : !flipX) ? width : 0)
				: (start.x + end.x) / 2 - width / 2
			: Math.min(start.x, end.x)
		return {
			position: { x: left, y: midY - height / 2 },
			size: { width, height },
			flipX,
			flipY: false,
			axis,
		}
	}

	if (axis === 'v') {
		const midX = anchor?.point.x ?? (start.x + end.x) / 2
		const width = LINE_MIN_EXTENT
		const height = Math.max(dy, LINE_MIN_EXTENT)
		const top = dy < LINE_MIN_EXTENT
			? anchor
				? anchor.point.y - ((anchor.which === 'start' ? flipY : !flipY) ? height : 0)
				: (start.y + end.y) / 2 - height / 2
			: Math.min(start.y, end.y)
		return {
			position: { x: midX - width / 2, y: top },
			size: { width, height },
			flipX: false,
			flipY,
			axis,
		}
	}

	const width = Math.max(dx, LINE_MIN_EXTENT)
	const height = Math.max(dy, LINE_MIN_EXTENT)

	if (anchor) {
		// Pad away from the anchored endpoint so its absolute position is exact
		// even when dx/dy is below LINE_MIN_EXTENT (near-axis diagonals).
		const anchorLocalX = (anchor.which === 'start' ? flipX : !flipX) ? width : 0
		const anchorLocalY = (anchor.which === 'start' ? flipY : !flipY) ? height : 0
		return {
			position: {
				x: anchor.point.x - anchorLocalX,
				y: anchor.point.y - anchorLocalY,
			},
			size: { width, height },
			flipX,
			flipY,
			axis,
		}
	}

	let left = Math.min(start.x, end.x)
	let top = Math.min(start.y, end.y)

	if (dx < LINE_MIN_EXTENT) {
		left -= (LINE_MIN_EXTENT - dx) / 2
	}
	if (dy < LINE_MIN_EXTENT) {
		top -= (LINE_MIN_EXTENT - dy) / 2
	}

	return {
		position: { x: left, y: top },
		size: { width, height },
		flipX,
		flipY,
		axis,
	}
}

function shorten_point(from: Position, to: Position, by: number): Position {
	const dx = to.x - from.x
	const dy = to.y - from.y
	const len = Math.hypot(dx, dy)
	if (len <= by || len === 0) return { ...from }
	const t = (len - by) / len
	return {
		x: from.x + dx * t,
		y: from.y + dy * t,
	}
}

function arrow_polygon(tip: Position, from: Position, size: number, color: string): string {
	const dx = tip.x - from.x
	const dy = tip.y - from.y
	const len = Math.hypot(dx, dy) || 1
	const ux = dx / len
	const uy = dy / len
	const px = -uy
	const py = ux
	const back = size
	const half = size * 0.55
	const baseX = tip.x - ux * back
	const baseY = tip.y - uy * back
	const points = [
		`${tip.x},${tip.y}`,
		`${baseX + px * half},${baseY + py * half}`,
		`${baseX - px * half},${baseY - py * half}`,
	].join(' ')
	return `<polygon class="pc-line-head" points="${points}" fill="${color}" pointer-events="fill"/>`
}

/** Build a line/arrow SVG sized to the widget box (no stretch needed). */
export function build_line_svg(meta: LineShapeMeta): string {
	const width = Math.max(meta.width, LINE_MIN_EXTENT)
	const height = Math.max(meta.height, LINE_MIN_EXTENT)
	const axis = meta.axis ?? 'd'
	const { start, end } = local_endpoints(width, height, meta.flipX, meta.flipY, axis)
	const color = meta.color
	const strokeWidth = meta.strokeWidth

	const shortenStart = meta.startPlug === 'arrow' ? LINE_ARROW_SIZE * 0.85 : 0
	const shortenEnd = meta.endPlug === 'arrow' ? LINE_ARROW_SIZE * 0.85 : 0
	const lineStart = shortenStart > 0 ? shorten_point(end, start, shortenStart) : start
	const lineEnd = shortenEnd > 0 ? shorten_point(start, end, shortenEnd) : end

	const heads: string[] = []
	if (meta.startPlug === 'arrow') {
		heads.push(arrow_polygon(start, end, LINE_ARROW_SIZE, color))
	}
	if (meta.endPlug === 'arrow') {
		heads.push(arrow_polygon(end, start, LINE_ARROW_SIZE, color))
	}

	// Visual stroke first; wider transparent hit stroke on top for pointer targeting.
	// SVG root is pointer-events:none so empty bbox passes clicks through.
	return [
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}"`,
		` data-pc-line="1"`,
		` data-start-plug="${meta.startPlug}"`,
		` data-end-plug="${meta.endPlug}"`,
		` data-flip-x="${meta.flipX ? '1' : '0'}"`,
		` data-flip-y="${meta.flipY ? '1' : '0'}"`,
		` data-axis="${axis}"`,
		` overflow="visible" pointer-events="none">`,
		`<line class="pc-line-stroke" x1="${lineStart.x}" y1="${lineStart.y}" x2="${lineEnd.x}" y2="${lineEnd.y}"`,
		` stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" pointer-events="none"/>`,
		`<line class="pc-line-hit" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}"`,
		` stroke="transparent" stroke-width="${LINE_HIT_STROKE_WIDTH}" stroke-linecap="round" pointer-events="stroke"/>`,
		...heads,
		`</svg>`,
	].join('')
}

/**
 * Parse line metadata from SVG. Legacy mid-line templates become a horizontal
 * arrow-capable line with default plugs.
 */
export function parse_line_meta(svg: string, fallbackSize?: Size): LineShapeMeta | null {
	if (!is_line_shape(svg)) return null

	const color = read_shape_color(svg) ?? SHAPE_LINE_DEFAULT_STROKE
	const strokeMatch = svg.match(
		/<line\b[^>]*class="[^"]*pc-line-stroke[^"]*"[^>]*\sstroke-width="([^"]+)"/i,
	) ?? svg.match(
		/<line\b(?![^>]*pc-line-hit)[^>]*\sstroke-width="([^"]+)"/i,
	)
	const strokeWidth = strokeMatch ? Number.parseFloat(strokeMatch[1]!) || LINE_STROKE_WIDTH : LINE_STROKE_WIDTH

	if (/data-pc-line\s*=\s*["']?1["']?/i.test(svg)) {
		const viewBox = attr(svg, 'viewBox')?.trim().split(/[\s,]+/).map(Number)
		const width = viewBox?.[2] && viewBox[2] > 0
			? viewBox[2]
			: (fallbackSize?.width ?? SHAPE_LINE_DEFAULT_SIZE.width)
		const height = viewBox?.[3] && viewBox[3] > 0
			? viewBox[3]
			: (fallbackSize?.height ?? SHAPE_LINE_DEFAULT_SIZE.height)

		return {
			width,
			height,
			flipX: parse_bool_flag(attr(svg, 'data-flip-x')),
			flipY: parse_bool_flag(attr(svg, 'data-flip-y')),
			axis: parse_axis(attr(svg, 'data-axis'), width, height),
			startPlug: parse_plug(attr(svg, 'data-start-plug')),
			endPlug: parse_plug(attr(svg, 'data-end-plug')),
			color,
			strokeWidth,
		}
	}

	// Legacy horizontal mid-line in a fixed 100×100 viewBox.
	const size = fallbackSize ?? SHAPE_LINE_DEFAULT_SIZE
	return {
		width: size.width,
		height: size.height,
		flipX: false,
		flipY: false,
		axis: 'h',
		startPlug: 'none',
		endPlug: 'none',
		color,
		strokeWidth,
	}
}

/** Reads the primary fill or stroke color from a shape SVG. */
export function read_shape_color(svg: string): string | undefined {
	if (is_line_shape(svg)) {
		for (const match of svg.matchAll(/<line\b[^>]*\/?>/gi)) {
			const tag = match[0]
			const cls = attr(tag, 'class') ?? ''
			if (cls.includes('pc-line-hit')) continue
			const stroke = attr(tag, 'stroke')
			if (stroke !== undefined && stroke.trim().toLowerCase() !== 'transparent') {
				return stroke
			}
		}
		return undefined
	}

	for (const match of svg.matchAll(PAINTABLE_ELEMENT_RE)) {
		const fill = read_style_fill(match[0]) ?? attr(match[0], 'fill')
		if (fill !== undefined && is_recolorable_fill(fill)) return fill
	}
	for (const match of svg.matchAll(/<g\b[^>]*>/gi)) {
		const fill = read_style_fill(match[0]) ?? attr(match[0], 'fill')
		if (fill !== undefined && is_recolorable_fill(fill)) return fill
	}
	const styleBody = svg.match(/<style\b[^>]*>([\s\S]*?)<\/style>/i)?.[1]
	const cssFill = styleBody?.match(/fill\s*:\s*([^;}]+)/i)?.[1]
	if (cssFill !== undefined && is_recolorable_fill(cssFill)) return cssFill.trim()
	return undefined
}

/** Applies a fill (or stroke for line-only SVGs) to shape elements. */
export function apply_shape_color(svg: string, color: string): string {
	if (is_line_shape(svg)) {
		let next = svg.replace(/<line\b[^>]*\/?>/gi, (tag) => {
			const cls = attr(tag, 'class') ?? ''
			if (cls.includes('pc-line-hit')) return tag
			const stroke = attr(tag, 'stroke')
			if (stroke !== undefined && stroke.trim().toLowerCase() === 'transparent') return tag
			return set_attr_on_tag(tag, 'stroke', color)
		})
		// Arrowhead polygons share the stroke color.
		if (/data-pc-line\s*=\s*["']?1["']?/i.test(next)) {
			next = next.replace(/<polygon\b[^>]*\/?>/gi, (tag) => {
				if (attr(tag, 'fill') === undefined) return tag
				return set_attr_on_tag(tag, 'fill', color)
			})
		}
		return next
	}

	let next = svg.replace(PAINTABLE_ELEMENT_RE, (tag) => {
		const fill = attr(tag, 'fill')
		if (fill !== undefined && !is_recolorable_fill(fill)) return tag
		return set_style_fill(set_attr_on_tag(tag, 'fill', color), color)
	})
	next = next.replace(/<g\b[^>]*>/gi, (tag) => {
		const fill = read_style_fill(tag) ?? attr(tag, 'fill')
		if (fill === undefined || !is_recolorable_fill(fill)) return tag
		return set_style_fill(set_attr_on_tag(tag, 'fill', color), color)
	})
	return next.replace(
		/(<style\b[^>]*>)([\s\S]*?)(<\/style>)/gi,
		(_whole, open: string, body: string, close: string) => {
			const recolored = body.replace(
				/(fill\s*:\s*)([^;}]+)/gi,
				(decl, prop: string, value: string) =>
					is_recolorable_fill(value) ? `${prop}${color}` : decl,
			)
			return `${open}${recolored}${close}`
		},
	)
}

const DANGEROUS_URL = /^\s*(javascript:|data:)/i

/** Drop href/src-like attributes whose value is a javascript: or data: URL. */
function strip_dangerous_url_attrs(html: string): string {
	return html.replace(
		/\s(?:href|xlink:href|src|action)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
		(match, double_q: string | undefined, single_q: string | undefined, bare: string | undefined) => {
			const value = double_q ?? single_q ?? bare ?? ''
			return DANGEROUS_URL.test(value) ? '' : match
		},
	)
}

/** Drop style attributes that embed javascript:/data: urls or CSS expression(). */
function strip_dangerous_styles(html: string): string {
	return html.replace(
		/\sstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi,
		(match, double_q: string | undefined, single_q: string | undefined) => {
			const value = double_q ?? single_q ?? ''
			if (/url\s*\(\s*['"]?\s*(javascript:|data:)/i.test(value)) return ''
			if (/expression\s*\(/i.test(value)) return ''
			return match
		},
	)
}

/**
 * Regex fallback for environments without a DOM (node tests). Strips
 * scripts, foreignObject, event handlers, and javascript:/data: URLs — but a
 * regex cannot be exhaustive (SMIL `<animate attributeName="href">`, entity
 * tricks), which is why the browser path below uses DOMPurify.
 */
function regex_sanitize_svg(raw: string): string {
	return strip_dangerous_styles(
		strip_dangerous_url_attrs(
			raw
				.replace(/<script\b[\s\S]*?>[\s\S]*?<\/script>/gi, '')
				.replace(/<foreignObject\b[\s\S]*?>[\s\S]*?<\/foreignObject>/gi, '')
				.replace(/<(?:iframe|embed|object)\b[\s\S]*?>[\s\S]*?<\/(?:iframe|embed|object)>/gi, '')
				.replace(/<(?:iframe|embed|object)\b[^>]*\/?>/gi, '')
				.replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, ''),
		),
	)
}

// DOMPurify needs a DOM; in the node test environment it exports a factory
// without `sanitize` (same situation as widgets/markdown.ts)
const can_purify = typeof DOMPurify.sanitize === 'function'

/**
 * SVG sanitizer for preview HTML rendered with v-html. Shape files come from
 * shared and public boards, i.e. from other users: in the browser this is
 * DOMPurify's SVG profile (no scripts, no foreignObject, no SMIL animate/set,
 * safe URLs only); the regex pass runs on top so both paths agree on the
 * style/url rules the recolor code relies on.
 */
export function sanitize_svg(raw: string): string {
	const purified = can_purify
		? DOMPurify.sanitize(raw, {
			USE_PROFILES: { svg: true, svgFilters: true },
			FORBID_TAGS: ['foreignObject', 'script', 'iframe', 'embed', 'object', 'animate', 'set'],
		})
		: raw
	return regex_sanitize_svg(purified)
}

export function prepare_svg_for_preview(raw: string): string {
	const sanitized = sanitize_svg(raw)
	const isPcLine = /data-pc-line\s*=\s*["']?1["']?/i.test(sanitized)

	return sanitized.replace(/<svg([^>]*)>/i, (_match, attrs: string) => {
		const cleaned = attrs
			.replace(/\spreserveAspectRatio="[^"]*"/gi, '')
			.replace(/\swidth="[^"]*"/gi, '')
			.replace(/\sheight="[^"]*"/gi, '')

		// New line/arrow SVGs are authored at widget pixel size — keep uniform scaling
		// so arrowheads stay undistorted. Legacy mid-line templates still stretch.
		const aspect = isPcLine ? 'xMidYMid meet' : 'none'
		return `<svg${cleaned} width="100%" height="100%" preserveAspectRatio="${aspect}">`
	})
}

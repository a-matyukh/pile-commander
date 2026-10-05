export type MarqueeRect = {
	x: number
	y: number
	width: number
	height: number
}

export type Bounds = {
	x: number
	y: number
	width: number
	height: number
}

/** Minimum overlap area (px²) to count as a hit — filters 1px grazes, Finder-like otherwise. */
export const MIN_MARQUEE_INTERSECTION_AREA = 16

export function normalizeRect(
	x0: number,
	y0: number,
	x1: number,
	y1: number,
): MarqueeRect {
	const left = Math.min(x0, x1)
	const top = Math.min(y0, y1)
	return {
		x: left,
		y: top,
		width: Math.abs(x1 - x0),
		height: Math.abs(y1 - y0),
	}
}

export function rectsIntersect(a: Bounds, b: Bounds): boolean {
	return (
		a.x < b.x + b.width
		&& a.x + a.width > b.x
		&& a.y < b.y + b.height
		&& a.y + a.height > b.y
	)
}

/** Intersection rectangle of two AABBs, or null if they do not overlap. */
export function intersectionRect(a: Bounds, b: Bounds): MarqueeRect | null {
	const left = Math.max(a.x, b.x)
	const top = Math.max(a.y, b.y)
	const right = Math.min(a.x + a.width, b.x + b.width)
	const bottom = Math.min(a.y + a.height, b.y + b.height)
	if (right <= left || bottom <= top) return null
	return {
		x: left,
		y: top,
		width: right - left,
		height: bottom - top,
	}
}

/**
 * Finder-style hit: any noticeable overlap selects the item.
 * Does not require the marquee to fully enclose the widget.
 */
export function marqueeHitsBounds(
	marquee: Bounds,
	bounds: Bounds,
	minArea = MIN_MARQUEE_INTERSECTION_AREA,
): boolean {
	const overlap = intersectionRect(marquee, bounds)
	if (!overlap) return false
	return overlap.width * overlap.height >= minArea
}

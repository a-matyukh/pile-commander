/** Gap between masonry cards, horizontal and vertical. */
export const MASONRY_GAP = 12

export const MASONRY_COLUMN_PRESETS = [
	{ id: 'S', width: 180 },
	{ id: 'M', width: 240 },
	{ id: 'L', width: 320 },
] as const

export const MASONRY_DEFAULT_COLUMN_WIDTH = 240

export function masonryColumnWidth(stored: number | undefined): number {
	if (stored === 180 || stored === 320 || stored === 240) return stored
	return MASONRY_DEFAULT_COLUMN_WIDTH
}

/**
 * How many columns fit. `maxColumns` null is Auto (as many as fit).
 * A cap never exceeds what the pane can hold, and the pane always gets at least one.
 */
export function masonryColumnCount(
	paneWidth: number,
	columnWidth: number,
	maxColumns: number | null,
): number {
	const fit = Math.max(1, Math.floor((Math.max(0, paneWidth) + MASONRY_GAP) / (columnWidth + MASONRY_GAP)))
	if (maxColumns == null || !Number.isFinite(maxColumns) || maxColumns < 1) return fit
	return Math.max(1, Math.min(Math.floor(maxColumns), fit))
}

/**
 * Pinterest order: each next item goes to the shortest column, and to the
 * left one when lengths tie. Returns column lists of input indexes.
 * Column length includes the gap between cards, matching the rendered strip.
 */
export function layoutMasonry(heights: number[], columns: number): number[][] {
	const count = Math.max(1, Math.floor(columns) || 1)
	const cols: number[][] = Array.from({ length: count }, () => [])
	const totals = Array<number>(count).fill(0)
	for (let index = 0; index < heights.length; index++) {
		let best = 0
		for (let col = 1; col < count; col++) {
			if (totals[col]! < totals[best]!) best = col
		}
		const column = cols[best]!
		const gap = column.length > 0 ? MASONRY_GAP : 0
		column.push(index)
		totals[best] = totals[best]! + gap + Math.max(0, heights[index] ?? 0)
	}
	return cols
}

export function sameMasonryColumns(a: number[][], b: number[][]): boolean {
	if (a.length !== b.length) return false
	return a.every((col, i) => {
		const other = b[i]
		return !!other && col.length === other.length && col.every((index, j) => index === other[j])
	})
}

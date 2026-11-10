import type { DockItem, DockItemId } from './canvasDockItems'

/** Sizes of the panel in px. The component draws with the same numbers the layout counts with */
export type DockMetrics = {
	button: number
	/** Between two buttons of one group */
	gap: number
	/** A separator with its margins */
	sep: number
	/** The island's inner padding, each side */
	pad: number
	/** The zoom readout */
	zoom: number
}

export const DOCK_METRICS = {
	regular: { button: 40, gap: 2, sep: 9, pad: 4, zoom: 64 },
	/** A folder preview's panel */
	small: { button: 32, gap: 2, sep: 7, pad: 3, zoom: 52 },
} satisfies Record<string, DockMetrics>

/** The island's border, both sides */
const BORDER = 1

export type DockLayout = {
	/** On the panel, in the panel's order */
	inline: DockItemId[]
	/** Under "more", in the panel's order */
	overflow: DockItemId[]
	more: boolean
}

function item_width(item: DockItem, metrics: DockMetrics): number {
	return item.id === 'zoom' ? metrics.zoom : metrics.button
}

/** How wide the island is with these items on it, and "more" at its end when asked */
export function dock_width(items: DockItem[], more: boolean, metrics: DockMetrics): number {
	const groups = new Map<number, number>()
	for (const item of items) {
		const so_far = groups.get(item.group)
		groups.set(item.group, so_far === undefined ? item_width(item, metrics) : so_far + metrics.gap + item_width(item, metrics))
	}
	let width = 0
	for (const group_width of groups.values()) width += group_width
	const count = groups.size + (more ? 1 : 0)
	if (more) width += metrics.button
	return width + Math.max(0, count - 1) * metrics.sep + metrics.pad * 2 + BORDER
}

/**
 * What fits on a panel this wide. Everything in a row when it fits. Otherwise
 * "more" takes its place at the end and items leave for it one by one, the
 * least needed first, until the rest fits.
 */
export function dock_layout(items: DockItem[], width: number, metrics: DockMetrics): DockLayout {
	if (dock_width(items, false, metrics) <= width) {
		return { inline: items.map(item => item.id), overflow: [], more: false }
	}
	const dropped = new Set<DockItemId>()
	const kept = () => items.filter(item => !dropped.has(item.id))
	for (const item of [...items].sort((a, b) => b.keep - a.keep)) {
		dropped.add(item.id)
		if (dock_width(kept(), true, metrics) <= width) break
	}
	return {
		inline: kept().map(item => item.id),
		overflow: items.filter(item => dropped.has(item.id)).map(item => item.id),
		more: true,
	}
}

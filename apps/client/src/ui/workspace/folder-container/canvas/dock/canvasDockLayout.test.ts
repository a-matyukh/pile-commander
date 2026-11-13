import { describe, expect, test } from 'vitest'
import { dock_items } from './canvasDockItems'
import { DOCK_METRICS, dock_layout, dock_width } from './canvasDockLayout'

const full = dock_items({ can_write: true, embedded: false })
const preview = dock_items({ can_write: true, embedded: true })
const viewer = dock_items({ can_write: false, embedded: false })

describe('dock_items', () => {
	test('a writable canvas has the tools in the toolbar order and the zoom: undo is in the top bar', () => {
		expect(full.map(item => item.id)).toEqual([
			'hand', 'select', 'lasso', 'connect', 'disconnect', 'pen', 'eraser', 'zoom',
		])
	})

	test('a folder preview has the same panel', () => {
		expect(preview).toEqual(full)
	})

	test('a viewer keeps only the zoom', () => {
		expect(viewer.map(item => item.id)).toEqual(['zoom'])
	})
})

describe('dock_width', () => {
	test('counts buttons, gaps inside groups, separators between them, padding and border', () => {
		// 7 buttons, 4 gaps inside groups, the zoom, 3 separators, padding, border
		expect(dock_width(full, false, DOCK_METRICS.regular)).toBe(7 * 40 + 4 * 2 + 64 + 3 * 9 + 8 + 1)
	})

	test('"more" is one more group', () => {
		const tools = full.filter(item => item.id === 'hand' || item.id === 'select')
		expect(dock_width(tools, false, DOCK_METRICS.regular)).toBe(82 + 8 + 1)
		expect(dock_width(tools, true, DOCK_METRICS.regular)).toBe(82 + 9 + 40 + 8 + 1)
	})

	test('a group left without items leaves no separator', () => {
		const without_connections = full.filter(item => item.group !== 2)
		const expected = dock_width(full, false, DOCK_METRICS.regular) - (82 + 9)
		expect(dock_width(without_connections, false, DOCK_METRICS.regular)).toBe(expected)
	})
})

describe('dock_layout', () => {
	test('a wide canvas shows everything and no "more"', () => {
		expect(dock_layout(full, 900, DOCK_METRICS.regular)).toEqual({
			inline: full.map(item => item.id),
			overflow: [],
			more: false,
		})
	})

	test('exactly as wide as the panel still fits', () => {
		const width = dock_width(full, false, DOCK_METRICS.regular)
		expect(dock_layout(full, width, DOCK_METRICS.regular).more).toBe(false)
		expect(dock_layout(full, width - 1, DOCK_METRICS.regular).more).toBe(true)
	})

	test('a phone keeps the main tools and "more"', () => {
		// 375px wide screen less the panel's side margins
		expect(dock_layout(full, 359, DOCK_METRICS.regular)).toEqual({
			inline: ['hand', 'select', 'lasso', 'connect', 'pen', 'eraser'],
			overflow: ['disconnect', 'zoom'],
			more: true,
		})
	})

	test('a narrower phone gives up Lasso next', () => {
		expect(dock_layout(full, 304, DOCK_METRICS.regular)).toEqual({
			inline: ['hand', 'select', 'connect', 'pen', 'eraser'],
			overflow: ['lasso', 'disconnect', 'zoom'],
			more: true,
		})
	})

	test('what stays keeps the panel order, and so does what leaves', () => {
		const layout = dock_layout(full, 250, DOCK_METRICS.regular)
		const order = full.map(item => item.id)
		const in_order = (ids: string[]) => ids.every((id, i) => i === 0 || order.indexOf(ids[i - 1] as never) < order.indexOf(id as never))
		expect(in_order(layout.inline)).toBe(true)
		expect(in_order(layout.overflow)).toBe(true)
		expect([...layout.inline, ...layout.overflow].sort()).toEqual([...order].sort())
	})

	test('Hand is the last to leave', () => {
		const width = dock_width(full.filter(item => item.id === 'hand'), true, DOCK_METRICS.regular)
		expect(dock_layout(full, width, DOCK_METRICS.regular).inline).toEqual(['hand'])
	})

	test('a canvas too narrow for any tool is left with "more" alone', () => {
		expect(dock_layout(full, 60, DOCK_METRICS.regular)).toEqual({
			inline: [],
			overflow: full.map(item => item.id),
			more: true,
		})
	})

	test('a folder preview tucks the zoom away first and keeps every tool', () => {
		expect(dock_layout(preview, 304, DOCK_METRICS.small)).toEqual({
			inline: ['hand', 'select', 'lasso', 'connect', 'disconnect', 'pen', 'eraser'],
			overflow: ['zoom'],
			more: true,
		})
	})

	test('a viewer sees the zoom alone', () => {
		expect(dock_layout(viewer, 359, DOCK_METRICS.regular)).toEqual({
			inline: ['zoom'],
			overflow: [],
			more: false,
		})
	})
})

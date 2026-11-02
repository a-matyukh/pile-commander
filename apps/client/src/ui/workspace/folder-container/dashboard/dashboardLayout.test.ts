import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import {
	DASHBOARD_COLS,
	dashboardCellsToWrite,
	widgetsToDashboardLayout,
} from './dashboardLayout'

function file(partial: Pick<FolderContainerWidgetChild, 'id'> & Partial<FolderContainerWidgetChild>): FolderContainerWidgetChild {
	return {
		id: partial.id,
		name: partial.id,
		type: 'file',
		position: partial.position,
		size: partial.size,
		dashboard: partial.dashboard,
	}
}

describe('dashboard layout', () => {
	test('keeps a saved cell and does not read a pixel position as a cell', () => {
		const widgets = [
			file({
				id: 'wide',
				dashboard: { x: 11, y: 4, w: 1, h: 2 },
				position: { x: 0, y: 0 },
			}),
			file({
				id: 'fresh',
				position: { x: 1, y: 0 },
				size: { width: 80, height: 80 },
			}),
		]

		const layout = widgetsToDashboardLayout(widgets)
		expect(layout.find(item => item.i === 'wide')).toMatchObject({ x: 11, y: 4, w: 1, h: 2 })
		const fresh = layout.find(item => item.i === 'fresh')
		expect(fresh).toMatchObject({ x: 0, y: 0, w: 1, h: 1 })
		expect(layout.every(item => item.x + item.w <= DASHBOARD_COLS)).toBe(true)
		// No pane width goes in, so the same widgets always produce the same cells.
		expect(widgetsToDashboardLayout(widgets)).toEqual(layout)
	})

	test('writes only cards whose cell changed or that have no cell yet', () => {
		const layout = [
			{ i: 'kept', x: 0, y: 0, w: 2, h: 1 },
			{ i: 'moved', x: 3, y: 1, w: 2, h: 1 },
			{ i: 'new', x: 6, y: 0, w: 1, h: 1 },
		]
		const current = new Map([
			['kept', { x: 0, y: 0, w: 2, h: 1 }],
			['moved', { x: 3, y: 0, w: 2, h: 1 }],
		])
		expect(dashboardCellsToWrite(layout, current).map(item => item.i)).toEqual(['moved', 'new'])
	})
})

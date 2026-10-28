import { describe, expect, test, vi } from 'vitest'
import type { WorkspaceStore } from '@/domain/Store'
import { FOLDER_VIEWS } from '@/domain/Widget'
import { t } from '@/i18n'
import { ADD_SHAPES, ADD_SHAPE_META, add_menu_has_pane_items, add_note, add_shape } from './add_menu'

function fake_workspace() {
	return {
		create_note: vi.fn(async () => 'note'),
		create_shape: vi.fn(async () => 'shape'),
		create_line: vi.fn(async () => 'line'),
	}
}
const as_store = (fake: ReturnType<typeof fake_workspace>) => fake as unknown as WorkspaceStore

describe('"Add" in the folder header', () => {
	test('notes and shapes are offered in every view but the list and the gallery', () => {
		const with_pane = FOLDER_VIEWS.filter(add_menu_has_pane_items)
		expect(with_pane).toEqual(['board', 'canvas', 'stack', 'masonry', 'slides'])
	})

	test('"Shape ›" lists the templates of the current menu, the line split into a line and an arrow', () => {
		expect(ADD_SHAPES).toEqual(['rect', 'ellipse', 'triangle', 'diamond', 'line', 'arrow'])
		for (const shape of ADD_SHAPES) expect(t(ADD_SHAPE_META[shape].label_key)).not.toBe(ADD_SHAPE_META[shape].label_key)
	})

	test('a note and a shape go to the open folder through the store', async () => {
		const ws = fake_workspace()
		await add_note(as_store(ws), '/ws/A')
		expect(ws.create_note).toHaveBeenCalledWith('/ws/A')
		await add_shape(as_store(ws), '/ws/A', 'diamond')
		expect(ws.create_shape).toHaveBeenCalledWith('/ws/A', 'diamond')
		expect(ws.create_line).not.toHaveBeenCalled()
	})

	test('a line and an arrow are lines of the default length, as in the current menu', async () => {
		const ws = fake_workspace()
		await add_shape(as_store(ws), '/ws/A', 'line')
		await add_shape(as_store(ws), '/ws/A', 'arrow')
		expect(ws.create_line).toHaveBeenNthCalledWith(1, '/ws/A', { x: 100, y: 100 }, { x: 220, y: 100 }, 'none')
		expect(ws.create_line).toHaveBeenNthCalledWith(2, '/ws/A', { x: 100, y: 100 }, { x: 220, y: 100 }, 'arrow')
		expect(ws.create_shape).not.toHaveBeenCalled()
	})
})

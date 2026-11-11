import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { board_position, TILE } from '@/services/board/layout'
import { compute_nudge_positions } from './useMoveSelectedWidgets'

function widget(
	id: string,
	position?: { x: number; y: number },
): FolderContainerWidgetChild {
	return { id, name: `${id}.txt`, type: 'file', position }
}

describe('compute_nudge_positions', () => {
	test('moves selected widgets by 1px with step 1', () => {
		const moves = compute_nudge_positions(
			[widget('a', { x: 100, y: 50 })],
			['a'],
			{ x: 1, y: 0 },
			1,
		)
		expect(moves).toEqual([{ id: 'a', position: { x: 101, y: 50 } }])
	})

	test('moves by grid step (Shift+arrow)', () => {
		const moves = compute_nudge_positions(
			[widget('a', { x: 100, y: 50 })],
			['a'],
			{ x: 0, y: 1 },
			20,
		)
		expect(moves).toEqual([{ id: 'a', position: { x: 100, y: 70 } }])
	})

	test('moves only selected children', () => {
		const moves = compute_nudge_positions(
			[widget('a', { x: 0, y: 0 }), widget('b', { x: 10, y: 10 })],
			['b'],
			{ x: -1, y: 0 },
			1,
		)
		expect(moves).toEqual([{ id: 'b', position: { x: 9, y: 10 } }])
	})

	test('clamps to the non-negative quadrant', () => {
		const moves = compute_nudge_positions(
			[widget('a', { x: 3, y: 0 })],
			['a'],
			{ x: -1, y: -1 },
			20,
		)
		expect(moves).toEqual([{ id: 'a', position: { x: 0, y: 0 } }])
	})

	test('on the canvas and in 3D an item keeps going into the negative, and keeps its other coordinate', () => {
		const left = compute_nudge_positions([widget('a', { x: -200, y: -40 })], ['a'], { x: -1, y: 0 }, 1, false)
		expect(left).toEqual([{ id: 'a', position: { x: -201, y: -40 } }])
		const down = compute_nudge_positions([widget('a', { x: -200, y: -40 })], ['a'], { x: 0, y: 1 }, 20, false)
		expect(down).toEqual([{ id: 'a', position: { x: -200, y: -20 } }])
		const off_zero = compute_nudge_positions([widget('a', { x: 3, y: 0 })], ['a'], { x: -1, y: -1 }, 20, false)
		expect(off_zero).toEqual([{ id: 'a', position: { x: -17, y: -20 } }])
	})

	test('skips widgets already pinned to the moved edge', () => {
		const moves = compute_nudge_positions(
			[widget('a', { x: 0, y: 5 })],
			['a'],
			{ x: -1, y: 0 },
			1,
		)
		expect(moves).toEqual([])
	})

	test('falls back to the board slot for widgets without a position', () => {
		const children = [widget('a'), widget('b')]
		const moves = compute_nudge_positions(children, ['b'], { x: 1, y: 0 }, 1)
		const base = board_position(children[1]!, 1)
		expect(base).toEqual({ x: TILE.pad + TILE.width + TILE.gap, y: TILE.pad })
		expect(moves).toEqual([{ id: 'b', position: { x: base.x + 1, y: base.y } }])
	})
})

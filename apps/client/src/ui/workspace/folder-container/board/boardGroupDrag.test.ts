import { describe, expect, test } from 'vitest'
import { applyGroupDragDelta, relativePositionsForFolderDrop } from './boardGroupDrag'

describe('applyGroupDragDelta', () => {
	test('translates every member by the same delta without snapping', () => {
		const next = applyGroupDragDelta(
			{
				a: { x: 10, y: 20 },
				b: { x: 33, y: 47 },
			},
			{ x: 5, y: -3 },
		)
		expect(next).toEqual({
			a: { x: 15, y: 17 },
			b: { x: 38, y: 44 },
		})
	})

	test('preserves off-grid offsets so companions do not jump at drag start', () => {
		const starts = {
			primary: { x: 100, y: 100 },
			companion: { x: 33, y: 47 },
		}
		// Tiny primary delta (as at threshold cross) must not re-grid companions.
		const next = applyGroupDragDelta(starts, { x: 3, y: 1 })
		expect(next.companion).toEqual({ x: 36, y: 48 })
	})
})

describe('relativePositionsForFolderDrop', () => {
	test('keeps companion offset from primary inside the folder', () => {
		const next = relativePositionsForFolderDrop(
			'primary',
			{ x: 20, y: 30 },
			{
				primary: { x: 100, y: 400 },
				companion: { x: 180, y: 420 },
			},
		)
		expect(next).toEqual({
			primary: { x: 20, y: 30 },
			companion: { x: 100, y: 50 },
		})
	})

	test('uses start offsets even when primary was dragged far from seed', () => {
		// primary live drop ≠ primary start; offsets still come from starts.
		const next = relativePositionsForFolderDrop(
			'primary',
			{ x: 40, y: 10 },
			{
				primary: { x: 10, y: 10 },
				companion: { x: 90, y: 10 },
			},
		)
		expect(next.companion).toEqual({ x: 120, y: 10 })
	})
})

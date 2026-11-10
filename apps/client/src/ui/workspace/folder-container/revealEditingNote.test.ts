import { describe, expect, test } from 'vitest'
import { revealDelta, visiblePaneArea, type Box } from './revealEditingNote'

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom })

// A phone: 390 wide, the keyboard leaves 0..420 visible
const area = box(0, 0, 390, 420)

describe('revealDelta', () => {
	test('a note under the keyboard moves up just enough to sit above it', () => {
		expect(revealDelta(box(40, 600, 300, 700), area, 12)).toEqual({ dx: 0, dy: -292 })
	})

	test('a note above the visible part moves down', () => {
		expect(revealDelta(box(40, -200, 300, -100), area, 12)).toEqual({ dx: 0, dy: 212 })
	})

	test('a note already in view stays put', () => {
		expect(revealDelta(box(40, 100, 300, 200), area, 12)).toEqual({ dx: 0, dy: 0 })
	})

	test('a note taller or wider than the visible part shows its top-left, where the text starts', () => {
		expect(revealDelta(box(-100, 300, 600, 1300), area, 12)).toEqual({ dx: 112, dy: -288 })
	})

	test('a note off to the right comes in from the right', () => {
		expect(revealDelta(box(500, 100, 600, 200), area, 12)).toEqual({ dx: -222, dy: 0 })
	})
})

describe('visiblePaneArea', () => {
	test('is the pane cut by what the keyboard leaves', () => {
		expect(visiblePaneArea(box(0, 120, 390, 844), box(0, 0, 390, 420))).toEqual(box(0, 120, 390, 420))
	})

	test('is nothing when the pane is all under the keyboard', () => {
		expect(visiblePaneArea(box(0, 500, 390, 844), box(0, 0, 390, 420))).toBeNull()
	})
})

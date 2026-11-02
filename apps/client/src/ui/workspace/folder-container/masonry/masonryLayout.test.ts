import { describe, expect, test } from 'vitest'
import { layoutMasonry, masonryColumnCount } from './masonryLayout'

describe('layoutMasonry', () => {
	test('equal heights fill the first columns by rows', () => {
		expect(layoutMasonry([10, 10, 10, 10, 10, 10], 3)).toEqual([
			[0, 3],
			[1, 4],
			[2, 5],
		])
	})

	test('the next card goes to the shortest column', () => {
		expect(layoutMasonry([5, 20, 20, 8], 3)).toEqual([
			[0, 3],
			[1],
			[2],
		])
	})

	test('a tie goes to the left column', () => {
		expect(layoutMasonry([10, 10, 4], 2)).toEqual([
			[0, 2],
			[1],
		])
	})
})

describe('masonryColumnCount', () => {
	test('auto is however many columns fit, and a cap never exceeds that', () => {
		const pane = 240 * 3 + 12 * 2
		expect(masonryColumnCount(pane, 240, null)).toBe(3)
		expect(masonryColumnCount(pane, 240, 0)).toBe(3)
		expect(masonryColumnCount(pane, 240, 2)).toBe(2)
		expect(masonryColumnCount(100, 240, null)).toBe(1)
	})
})

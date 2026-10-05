import { describe, expect, test } from 'vitest'
import { applyGroupResizeDelta } from './boardGroupResize'

const MIN = { width: 100, height: 50 }

describe('applyGroupResizeDelta', () => {
	test('grows every member by the same pixel delta', () => {
		const next = applyGroupResizeDelta(
			{
				a: { width: 200, height: 120 },
				b: { width: 333, height: 77 },
			},
			{ width: 40, height: -20 },
			MIN,
		)
		expect(next).toEqual({
			a: { width: 240, height: 100 },
			b: { width: 373, height: 57 },
		})
	})

	test('clamps each member to minSize independently', () => {
		const next = applyGroupResizeDelta(
			{
				big: { width: 500, height: 400 },
				small: { width: 110, height: 60 },
			},
			{ width: -200, height: -200 },
			MIN,
		)
		expect(next).toEqual({
			big: { width: 300, height: 200 },
			small: { width: 100, height: 50 },
		})
	})

	test('returns empty map for an empty group', () => {
		expect(applyGroupResizeDelta({}, { width: 10, height: 10 }, MIN)).toEqual({})
	})
})

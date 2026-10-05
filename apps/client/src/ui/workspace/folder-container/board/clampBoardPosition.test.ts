import { describe, expect, test } from 'vitest'
import { clampBoardPosition } from './boardDragBinding'

describe('clampBoardPosition', () => {
	test('leaves positions past a typical viewport size unchanged', () => {
		// Previously restrictToParent used clientHeight (~400) and jumped these.
		expect(clampBoardPosition({ x: 50, y: 600 })).toEqual({ x: 50, y: 600 })
		expect(clampBoardPosition({ x: 1200, y: 80 })).toEqual({ x: 1200, y: 80 })
	})

	test('clamps negative coordinates to the origin', () => {
		expect(clampBoardPosition({ x: -10, y: 20 })).toEqual({ x: 0, y: 20 })
		expect(clampBoardPosition({ x: 15, y: -5 })).toEqual({ x: 15, y: 0 })
		expect(clampBoardPosition({ x: -1, y: -2 })).toEqual({ x: 0, y: 0 })
	})

	test('preserves zero and positive origin positions', () => {
		expect(clampBoardPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 })
		expect(clampBoardPosition({ x: 1, y: 1 })).toEqual({ x: 1, y: 1 })
	})
})

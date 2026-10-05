import { describe, expect, it } from 'vitest'
import {
	intersectionRect,
	marqueeHitsBounds,
	normalizeRect,
	rectsIntersect,
} from './marqueeGeometry'

describe('marqueeGeometry', () => {
	it('normalizes inverted drag corners', () => {
		expect(normalizeRect(10, 20, 4, 8)).toEqual({
			x: 4,
			y: 8,
			width: 6,
			height: 12,
		})
	})

	it('detects AABB overlap', () => {
		expect(
			rectsIntersect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 5, y: 5, width: 10, height: 10 },
			),
		).toBe(true)
		expect(
			rectsIntersect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 11, y: 0, width: 10, height: 10 },
			),
		).toBe(false)
	})

	it('computes intersection rect', () => {
		expect(
			intersectionRect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 5, y: 5, width: 10, height: 10 },
			),
		).toEqual({ x: 5, y: 5, width: 5, height: 5 })
		expect(
			intersectionRect(
				{ x: 0, y: 0, width: 10, height: 10 },
				{ x: 20, y: 20, width: 10, height: 10 },
			),
		).toBeNull()
	})

	it('hits on partial overlap without full enclosure (Finder-style)', () => {
		const widget = { x: 0, y: 0, width: 100, height: 80 }
		// Small corner nick — enough area, not full cover.
		expect(
			marqueeHitsBounds({ x: 90, y: 70, width: 40, height: 40 }, widget),
		).toBe(true)
		// Grazing 1px strip — below min area.
		expect(
			marqueeHitsBounds({ x: 99, y: 0, width: 20, height: 1 }, widget),
		).toBe(false)
		// No touch.
		expect(
			marqueeHitsBounds({ x: 200, y: 200, width: 20, height: 20 }, widget),
		).toBe(false)
	})
})

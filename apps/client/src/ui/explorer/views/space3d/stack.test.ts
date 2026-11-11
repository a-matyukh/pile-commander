import { describe, expect, test } from 'vitest'
import { CARD_HEIGHT, card_heights } from './stack'

type Box = Parameters<typeof card_heights>[0][number]

const card = (key: string, x: number, y: number, extra: Partial<Box> = {}): Box =>
	({ key, kind: 'note', x, y, w: 200, h: 200, z: null, ...extra })

describe('how high cards float by default', () => {
	test('a card on its own lies just over the floor; a model stands on it; a height set in 3D stays', () => {
		const heights = card_heights([
			card('alone', 0, 0),
			card('duck', 1000, 0, { kind: 'model' }),
			card('lifted', 2000, 0, { z: 120 }),
		])
		expect(heights.get('alone')).toBe(CARD_HEIGHT)
		expect(heights.get('duck')).toBe(0)
		expect(heights.get('lifted')).toBe(120)
	})

	test('a later card lies over every earlier card it overlaps, as on the board', () => {
		// "c" overlaps only "b"; "b" overlaps "a": counting overlaps would put "c" level with "b"
		const heights = card_heights([card('a', 0, 0), card('b', 150, 0), card('c', 300, 0)])
		expect(heights.get('b')!).toBeGreaterThan(heights.get('a')!)
		expect(heights.get('c')!).toBeGreaterThan(heights.get('b')!)
	})

	test('overlapping cards never share a height, even where the earlier one covers more', () => {
		// "wide" covers two earlier cards; "late" covers only "wide" and must still be above it
		const heights = card_heights([
			card('left', 0, 0),
			card('right', 300, 0),
			card('wide', 100, 50, { w: 300 }),
			card('late', 150, 150),
		])
		expect(heights.get('late')!).toBeGreaterThan(heights.get('wide')!)
	})

	test("hundreds of files on the board's default grid keep their order and stay a low stack", () => {
		// 200 px pictures on the board's 110 px grid, four to a row: each overlaps its neighbors
		const items = Array.from({ length: 300 }, (_, i) => card(`p${i}`, 20 + (i % 4) * 110, 20 + Math.floor(i / 4) * 110))
		const heights = card_heights(items)
		const values = [...heights.values()]
		expect(Math.max(...values)).toBeLessThanOrEqual(CARD_HEIGHT + 60 + 1e-9)
		for (let i = 1; i < items.length; i++) {
			for (let j = 0; j < i; j++) {
				const a = items[j]
				const b = items[i]
				const overlap = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4
				if (overlap) expect(heights.get(b.key)!).toBeGreaterThan(heights.get(a.key)!)
			}
		}
	})
})

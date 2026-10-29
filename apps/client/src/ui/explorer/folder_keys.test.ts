import { describe, expect, test } from 'vitest'
import { neighbor } from './folder_keys'

const rect = (left: number, top: number, width = 100, height = 40) =>
	({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect

describe('neighbor', () => {
	// a 2×2 gallery: a b / c d
	const items = {
		a: rect(0, 0),
		b: rect(120, 0),
		c: rect(0, 60),
		d: rect(120, 60),
	}
	const list = Object.entries(items).map(([id, r]) => ({ el: { id } as unknown as Element, rect: r }))
	const from = (id: keyof typeof items, dir: 'up' | 'down' | 'left' | 'right') =>
		(neighbor(list.filter(item => (item.el as unknown as { id: string }).id !== id), items[id], dir) as unknown as { id: string } | null)?.id ?? null

	test('moves along rows and columns, nothing past the edge', () => {
		expect(from('a', 'right')).toBe('b')
		expect(from('a', 'down')).toBe('c')
		expect(from('d', 'up')).toBe('b')
		expect(from('d', 'left')).toBe('c')
		expect(from('a', 'up')).toBeNull()
		expect(from('b', 'right')).toBeNull()
	})
})

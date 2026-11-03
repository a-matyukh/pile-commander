import { describe, expect, test } from 'vitest'
import { menu_layer_open, neighbor, rename_hotkey_target } from './folder_keys'

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

const f2 = (over: Partial<{ key: string; repeat: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) => ({
	key: 'F2', repeat: false, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over,
})

describe('menu_layer_open', () => {
	const layer = (over: { state?: string; hidden?: boolean; display?: string; visibility?: string } = {}) => ({
		getAttribute: (name: string) => name === 'data-state' ? over.state ?? null : null,
		hidden: over.hidden,
		style: { display: over.display, visibility: over.visibility },
	})

	test('an open menu takes the keys; a closed or hidden one does not', () => {
		expect(menu_layer_open(layer({ state: 'open' }))).toBe(true)
		expect(menu_layer_open(layer())).toBe(true)
		expect(menu_layer_open(layer({ state: 'closed' }))).toBe(false)
		expect(menu_layer_open(layer({ display: 'none' }))).toBe(false)
		expect(menu_layer_open(layer({ visibility: 'hidden' }))).toBe(false)
		expect(menu_layer_open(layer({ hidden: true }))).toBe(false)
	})
})

describe('rename_hotkey_target', () => {
	const children = [{ id: 'a' }, { id: 'b' }]

	test('F2 names the one selected item that is on screen', () => {
		expect(rename_hotkey_target(f2(), ['a'], children)?.id).toBe('a')
		expect(rename_hotkey_target(f2(), ['gone', 'b'], children)?.id).toBe('b')
	})

	test('a repeat, a modifier, another key, none or several selected do nothing', () => {
		expect(rename_hotkey_target(f2({ repeat: true }), ['a'], children)).toBeNull()
		expect(rename_hotkey_target(f2({ metaKey: true }), ['a'], children)).toBeNull()
		expect(rename_hotkey_target(f2({ ctrlKey: true }), ['a'], children)).toBeNull()
		expect(rename_hotkey_target(f2({ altKey: true }), ['a'], children)).toBeNull()
		expect(rename_hotkey_target(f2({ shiftKey: true }), ['a'], children)).toBeNull()
		expect(rename_hotkey_target(f2({ key: 'Enter' }), ['a'], children)).toBeNull()
		expect(rename_hotkey_target(f2(), [], children)).toBeNull()
		expect(rename_hotkey_target(f2(), ['a', 'b'], children)).toBeNull()
		expect(rename_hotkey_target(f2(), ['gone'], children)).toBeNull()
	})
})

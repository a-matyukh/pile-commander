import { describe, expect, test } from 'vitest'
import { parse_xattr_value, xattrs_map } from './xattrs'

describe('parse_xattr_value', () => {
	test('parses booleans, numbers, JSON and plain strings', () => {
		expect(parse_xattr_value('true')).toBe(true)
		expect(parse_xattr_value('false')).toBe(false)
		expect(parse_xattr_value('42')).toBe(42)
		expect(parse_xattr_value('3.14')).toBe(3.14)
		expect(parse_xattr_value('{"x":1}')).toEqual({ x: 1 })
		expect(parse_xattr_value('[1,2]')).toEqual([1, 2])
		expect(parse_xattr_value('hello')).toBe('hello')
		expect(parse_xattr_value('')).toBe('')
	})

	test('keeps numeric-looking strings that are not pure numbers when JSON fails', () => {
		expect(parse_xattr_value('01')).toBe(1)
	})
})

describe('xattrs_map', () => {
	test('maps name/value pairs through parse_xattr_value', () => {
		expect(xattrs_map([
			{ name: 'is_preview', value: 'true' },
			{ name: 'order', value: '2' },
			{ name: 'position', value: '{"x":10,"y":20}' },
		])).toEqual({
			is_preview: true,
			order: 2,
			position: { x: 10, y: 20 },
		})
	})
})

describe('pending_entry_xattr: a look in flight seen outside a store', () => {
	test('scoped to its workspace, removal is null, nothing pending is undefined', async () => {
		const { pending_entry_xattr, set_pending_entry_xattr, clear_pending_entry_xattr } = await import('./xattrs')
		set_pending_entry_xattr('/', 'view', 'gallery', 'ws-a')
		set_pending_entry_xattr('/', 'icon', '\0', 'ws-a')
		try {
			expect(pending_entry_xattr('/', 'view', 'ws-a')).toBe('gallery')
			expect(pending_entry_xattr('/', 'view', 'ws-b')).toBeUndefined()
			expect(pending_entry_xattr('/', 'icon', 'ws-a')).toBeNull()
		} finally {
			clear_pending_entry_xattr('/', 'view', undefined, 'ws-a')
			clear_pending_entry_xattr('/', 'icon', undefined, 'ws-a')
		}
	})
})

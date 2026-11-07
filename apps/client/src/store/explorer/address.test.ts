import { describe, expect, test } from 'vitest'
import { resolve_public_route } from '@/services/publicRoute'
import { address_of, location_of_route } from './address'
import type { PublicRoot } from './public_roots'

const roots = new Map<string, PublicRoot>([
	['ws-1', { id: 'ws-1', name: 'Trip', username: 'anna', slug: 'trip', can_fork: true, can_edit_source: false }],
])

describe('address_of', () => {
	test('public places get their address', () => {
		expect(address_of({ kind: 'page', page: 'hub' }, roots)).toBe('/hub')
		expect(address_of({ kind: 'page', page: 'profile', arg: 'anna' }, roots)).toBe('/anna')
		expect(address_of({ kind: 'folder', ref: { drive_id: 'public', root_id: 'ws-1', folder_id: '/' } }, roots)).toBe('/anna/trip')
		expect(address_of({ kind: 'folder', ref: { drive_id: 'public', root_id: 'ws-1', folder_id: '/Days/Day 1' } }, roots)).toBe('/anna/trip/Days/Day%201')
		expect(address_of({ kind: 'folder', ref: { drive_id: 'demo', root_id: '/demo', folder_id: '/demo' } }, roots)).toBe('/demo')
		expect(address_of({ kind: 'folder', ref: { drive_id: 'demo', root_id: '/demo', folder_id: '/demo/Use cases' } }, roots)).toBe('/demo/Use%20cases')
	})

	test('own places stand on the root', () => {
		expect(address_of({ kind: 'folder', ref: { drive_id: 'cloud', root_id: 'x', folder_id: '/a' } }, roots)).toBe('/')
		expect(address_of({ kind: 'page', page: 'settings' }, roots)).toBe('/')
		expect(address_of({ kind: 'folder', ref: { drive_id: 'public', root_id: 'unknown', folder_id: '/' } }, roots)).toBe('/')
		expect(address_of(null, roots)).toBe('/')
	})

	test('an address reads back to its place', () => {
		for (const path of ['/hub', '/anna', '/demo', '/demo/Use%20cases']) {
			const at = location_of_route(resolve_public_route(path))
			expect(address_of(at, roots)).toBe(path)
		}
		expect(resolve_public_route('/anna/trip/Days/Day%201')).toMatchObject({ path: '/Days/Day 1' })
	})
})

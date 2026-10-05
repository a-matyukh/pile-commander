import { describe, expect, it } from 'vitest'
import {
	public_window_path,
	window_content_matches_item,
	window_title,
	type AppWindow,
} from './Desktop'

function window_with(content: AppWindow['content']): AppWindow {
	return {
		id: 'w1',
		content,
		position: { x: 0, y: 0 },
		size: { width: 100, height: 100 },
		state: 'floating',
		z: 1,
	}
}

const cloud_item = { type: 'cloud' as const, id: 'clone-1', name: 'Hello' }
const local_item = { type: 'local' as const, id: '/Users/me/ws', name: 'local' }

describe('window_content_matches_item', () => {
	it('matches a workspace window to the same list item', () => {
		expect(window_content_matches_item(
			{ kind: 'workspace', item: cloud_item },
			cloud_item,
		)).toBe(true)
		expect(window_content_matches_item(
			{ kind: 'workspace', item: local_item },
			cloud_item,
		)).toBe(false)
	})

	it('keeps a public slug window when loading its cloud workspace', () => {
		expect(window_content_matches_item(
			{ kind: 'slug', username: 'matyukh', slug: 'hello' },
			cloud_item,
		)).toBe(true)
	})

	it('rejects slug windows for non-cloud items and other content kinds', () => {
		expect(window_content_matches_item(
			{ kind: 'slug', username: 'matyukh', slug: 'hello' },
			local_item,
		)).toBe(false)
		expect(window_content_matches_item({ kind: 'hub' }, cloud_item)).toBe(false)
		expect(window_content_matches_item({ kind: 'empty' }, cloud_item)).toBe(false)
	})
})

describe('window_title', () => {
	it('prefers the loaded workspace name over the public path', () => {
		const window = window_with({ kind: 'slug', username: 'matyukh', slug: 'hi-vika' })
		expect(window_title(window)).toBe('matyukh/hi-vika')
		expect(window_title(window, 'Hi Vika')).toBe('Hi Vika')
	})

	it('uses a name carried on the slug content before the store loads', () => {
		const window = window_with({
			kind: 'slug',
			username: 'matyukh',
			slug: 'hi-vika',
			name: 'Hi Vika',
		})
		expect(window_title(window)).toBe('Hi Vika')
	})

	it('uses the loaded name for owned workspaces too', () => {
		const window = window_with({ kind: 'workspace', item: cloud_item })
		expect(window_title(window)).toBe('Hello')
		expect(window_title(window, 'Renamed')).toBe('Renamed')
	})
})

describe('public_window_path', () => {
	it('returns username/slug only for public windows', () => {
		expect(public_window_path(window_with({ kind: 'slug', username: 'matyukh', slug: 'hi-vika' })))
			.toBe('matyukh/hi-vika')
		expect(public_window_path(window_with({ kind: 'workspace', item: cloud_item }))).toBeNull()
		expect(public_window_path(window_with({ kind: 'hub' }))).toBeNull()
	})
})

import { describe, expect, test } from 'vitest'
import type { ExplorerTreeRoot } from '@/store/explorer/tree'
import { live_folder_glyph, pick_bookmark_glyph } from './bookmark_glyph'

const canvas = [{ name: 'view', value: 'canvas' }]

function local_root(folders: Record<string, unknown> | null): ExplorerTreeRoot {
	return {
		drive: { id: 'local', kind: 'local' },
		root: { id: '/Users/me', name: 'me', can_write: true },
		workspace: folders ? { is_disposed: false, folders } : null,
		loading: false,
	} as unknown as ExplorerTreeRoot
}

const ref = { drive_id: 'local', root_id: '/Users/me', folder_id: '/Users/me/backlog' }

describe('bookmark glyph', () => {
	test('the folder\'s own read gives its view in color', () => {
		const item = local_root({ '/Users/me/backlog': { xattrs: canvas, children: [] } })
		expect(live_folder_glyph(ref, item, '/Users/me')).toEqual({ icon: 'tabler:artboard', color: '#1D9E75', plain: false })
	})

	test('an unread folder takes its attributes from the parent\'s listing', () => {
		const item = local_root({ '/Users/me': { xattrs: [], children: [{ id: '/Users/me/backlog', xattrs: canvas }] } })
		expect(live_folder_glyph(ref, item, '/Users/me')?.icon).toBe('tabler:artboard')
	})

	test('an icon chosen in the menu wins over the view', () => {
		const xattrs = [...canvas, { name: 'icon', value: 'tabler:star;#D4537E' }]
		const item = local_root({ '/Users/me/backlog': { xattrs, children: [] } })
		expect(live_folder_glyph(ref, item, '/Users/me')).toMatchObject({ color: '#D4537E', plain: false })
		expect(live_folder_glyph(ref, item, '/Users/me')?.icon).not.toBe('tabler:artboard')
	})

	test('nothing read: no live icon', () => {
		expect(live_folder_glyph(ref, local_root(null), '/Users/me')).toBeNull()
		expect(live_folder_glyph(ref, local_root({}), '/Users/me')).toBeNull()
		expect(live_folder_glyph(ref, null, '/Users/me')).toBeNull()
	})

	test('a cloud root not opened yet shows the view from the root list', () => {
		const item = {
			drive: { id: 'cloud', kind: 'cloud' },
			root: { id: 'ws1', name: 'Board', can_write: true, view: 'canvas' },
			workspace: null,
			loading: false,
		} as unknown as ExplorerTreeRoot
		expect(live_folder_glyph({ drive_id: 'cloud', root_id: 'ws1', folder_id: '/' }, item, null)?.icon).toBe('tabler:artboard')
	})

	test('read now, then seen last, then macOS\'s folder, then a folder', () => {
		const live = { icon: 'tabler:artboard', color: '#1D9E75', plain: false }
		const last = { icon: 'tabler:layout-kanban', plain: false }
		expect(pick_bookmark_glyph(live, last, 'tabler:download')).toEqual(live)
		expect(pick_bookmark_glyph(null, last, 'tabler:download')).toEqual(last)
		expect(pick_bookmark_glyph(null, undefined, 'tabler:download')).toEqual({ icon: 'tabler:download', plain: true })
		expect(pick_bookmark_glyph(null, undefined, null)).toEqual({ icon: 'tabler:folder', plain: true })
	})
})

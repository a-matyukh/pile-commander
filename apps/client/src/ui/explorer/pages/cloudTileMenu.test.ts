import { describe, expect, test, vi } from 'vitest'
import type { Drive } from '@/domain/Drive'
import { folder_menu_items } from '@/store/explorer/folder_menu'
import type { ExplorerTreeRoot } from '@/store/explorer/tree'
import { cloud_tile_context_menu } from './cloudTileMenu'

function cloud_item(): ExplorerTreeRoot {
	const drive = { id: 'cloud', kind: 'cloud' } as Drive
	return { drive, root: { id: 'ws-1', name: 'Harbor', can_write: true }, workspace: null, loading: false }
}

describe('cloud tile context menu', () => {
	test('a right click opens the app menu at the pointer, and the owner may rename', () => {
		const preventDefault = vi.fn()
		const menu = cloud_tile_context_menu(
			{ preventDefault, clientX: 18, clientY: 44 },
			{ id: 'ws-1', name: 'Harbor' },
			'owner',
		)
		expect(preventDefault).toHaveBeenCalledOnce()
		expect(menu).toEqual({
			folder: { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/' },
			name: 'Harbor',
			can_write: true,
			new_folder: true,
			x: 18,
			y: 44,
		})
		const owner = folder_menu_items(menu.folder, {
			item: cloud_item(),
			can_write: menu.can_write,
			desktop: false,
			owner: true,
		})
		expect(owner.rename).toBe(true)
		expect(owner.move_to_trash).toBe(true)

		const editor = cloud_tile_context_menu(
			{ preventDefault: vi.fn(), clientX: 0, clientY: 0 },
			{ id: 'ws-1', name: 'Harbor' },
			'editor',
		)
		expect(editor.can_write).toBe(true)
		expect(folder_menu_items(editor.folder, {
			item: cloud_item(),
			can_write: editor.can_write,
			desktop: false,
			owner: false,
		}).rename).toBe(false)

		const viewer = cloud_tile_context_menu(
			{ preventDefault: vi.fn(), clientX: 0, clientY: 0 },
			{ id: 'ws-1', name: 'Harbor' },
			'viewer',
		)
		expect(viewer.can_write).toBe(false)
	})
})

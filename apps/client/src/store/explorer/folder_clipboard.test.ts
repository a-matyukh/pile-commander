import { describe, expect, test, vi } from 'vitest'
import type { Drive } from '@/domain/Drive'
import { create_folder_clipboard } from './folder_clipboard'
import type { ExplorerTreeRoot } from './tree'

function root(drive_id: string, root_id: string): ExplorerTreeRoot {
	return {
		drive: { id: drive_id, kind: drive_id === 'cloud' ? 'cloud' : 'local' } as Drive,
		root: { id: root_id, name: root_id, can_write: true },
		workspace: null,
		loading: false,
	}
}

function setup() {
	const tree = {
		move_folder: vi.fn(async () => {}),
		transfer_folder: vi.fn(async () => {}),
		copy_folder: vi.fn(async () => {}),
	}
	return { tree, clipboard: create_folder_clipboard(tree as never) }
}

const home = root('local', '/Users/me')
const docs = { id: '/Users/me/docs', name: 'docs', type: 'folder' as const }

describe('folder clipboard', () => {
	test('a cut folder pastes like a drop: a move in its root, a transfer elsewhere, once', async () => {
		const { tree, clipboard } = setup()
		clipboard.cut(home, docs, 'docs')
		expect(clipboard.is_cut(home, docs.id)).toBe(true)
		await clipboard.paste(home, '/Users/me/pics')
		expect(tree.move_folder).toHaveBeenCalledWith(home, docs, '/Users/me/pics')
		expect(clipboard.clip).toBeNull()
		expect(clipboard.is_cut(home, docs.id)).toBe(false)

		const work = root('cloud', 'w1')
		clipboard.cut(home, docs, 'docs')
		await clipboard.paste(work, '/')
		expect(tree.transfer_folder).toHaveBeenCalledWith(home, docs, work, '/')
	})

	test('a copied folder stays on the clipboard and pastes again', async () => {
		const { tree, clipboard } = setup()
		const work = root('cloud', 'w1')
		clipboard.copy(home, docs, 'docs')
		await clipboard.paste(work, '/a')
		await clipboard.paste(home, '/Users/me')
		expect(tree.copy_folder).toHaveBeenCalledTimes(2)
		expect(tree.copy_folder).toHaveBeenLastCalledWith(home, docs, home, '/Users/me')
		expect(clipboard.clip?.mode).toBe('copy')
	})

	test('never into the folder itself or its subfolder; another root with the same path is fine', async () => {
		const { tree, clipboard } = setup()
		clipboard.cut(home, docs, 'docs')
		expect(clipboard.can_paste(home, '/Users/me/docs')).toBe(false)
		expect(clipboard.can_paste(home, '/Users/me/docs/sub')).toBe(false)
		expect(clipboard.can_paste(home, '/Users/me/docs2')).toBe(true)
		expect(clipboard.can_paste(root('local', '/Volumes/Disk'), '/Users/me/docs')).toBe(true)
		await clipboard.paste(home, '/Users/me/docs/sub')
		expect(tree.move_folder).not.toHaveBeenCalled()
		expect(clipboard.clip?.mode).toBe('cut')
	})
})

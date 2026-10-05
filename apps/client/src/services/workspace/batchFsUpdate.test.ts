import { describe, expect, test } from 'vitest'
import { createWorkspaceStore } from '@/store/index'
import { createFakeFileManager } from '@pile-commander/file-manager'
import { batch_fs_update_active, run_batch_fs_update } from '@/services/workspace/batchFsUpdate'

describe('batchFsUpdate', () => {
	test('run_batch_fs_update toggles active flag', async () => {
		expect(batch_fs_update_active()).toBe(false)
		await run_batch_fs_update(async () => {
			expect(batch_fs_update_active()).toBe(true)
		})
		expect(batch_fs_update_active()).toBe(false)
	})

	test('watch refresh is skipped during batch fs update', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/note.txt')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		const original = fake.fm.folder_with_children_xattrs.bind(fake.fm)
		let stale_refresh_attempts = 0
		fake.fm.folder_with_children_xattrs = async (id: string) => {
			if (batch_fs_update_active()) {
				stale_refresh_attempts++
				return {
					...(await original(id)),
					children: [],
				}
			}
			return original(id)
		}

		await store.run_batch_fs_update(async () => {
			fake.emit_watch_event('/ws', { kind: 'modify', ids: ['/ws/note.txt'] })
			await new Promise(resolve => setTimeout(resolve, 30))
		})

		expect(stale_refresh_attempts).toBe(0)
		expect(store.opened_folder.children.some(c => c.id === '/ws/note.txt')).toBe(true)
	})

	test('move into folder created during batch sees the tree target', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/a.txt')
		fake.set_xattr('/ws/a.txt', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/b.txt')
		fake.set_xattr('/ws/b.txt', 'position', JSON.stringify({ x: 250, y: 220 }))
		fake.set_xattr('/ws/b.txt', 'is_preview', 'true')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		let combinedId = ''
		await store.run_batch_fs_update(async () => {
			combinedId = await store.create_folder('/ws', { x: 100, y: 100 }, { view: 'board' })
			expect(combinedId).toBeTruthy()

			const movedA = await store.move('/ws/a.txt', combinedId, 0, '/ws')
			const movedB = await store.move('/ws/b.txt', combinedId, 1, '/ws')
			expect(movedA).toBeTruthy()
			expect(movedB).toBeTruthy()

			await store.reload_folder_cache(combinedId)
		})

		const childIds = store.folders[combinedId]?.children?.map(c => c.id) ?? []
		expect(childIds.some(id => id.endsWith('/a.txt'))).toBe(true)
		expect(childIds.some(id => id.endsWith('/b.txt'))).toBe(true)
	})
})

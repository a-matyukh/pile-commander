import { describe, expect, test } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import { createWorkspaceStore } from '@/store/createWorkspaceStore'
import cloud from '@/store/cloud'
import { cloud_page_xattrs, root_look_from_xattrs, root_look_xattrs } from './rootLook'

describe('workspace root look', () => {
	test('an unopened workspace shows a color cover and a pile cover', () => {
		const color = root_look_xattrs(root_look_from_xattrs({ cover: '#aabbcc', view: 'board' }))
		expect(color).toEqual([
			{ name: 'view', value: 'board' },
			{ name: 'cover', value: '#aabbcc' },
		])
		const pile = root_look_xattrs(root_look_from_xattrs({ cover: 'pile:cover-abcdef01.webp' }))
		expect(pile).toEqual([{ name: 'cover', value: 'pile:cover-abcdef01.webp' }])
		expect(root_look_xattrs(root_look_from_xattrs({ cover: 'none' }))).toBeUndefined()
	})

	test('a root cover written here is what CloudPage shows after the store closes', async () => {
		const saved = { ...cloud.root_look }
		const fake = createFakeFileManager()
		fake.seed_folder('/')
		fake.set_xattr('/', 'cover', '#111111')
		cloud.root_look = { 'ws-1': { cover: '#111111' } }
		const store = await createWorkspaceStore(
			{ id: 'ws-1', type: 'cloud', name: 'Harbor' },
			fake.fm,
			{ root_folder_id: '/', live: false },
		)
		if (!store) throw new Error('no store')
		try {
			await store.change_folder_cover('/', '#222222')
			store.dispose()
			const shown = cloud_page_xattrs(
				store.folders['/']?.xattrs,
				store.is_disposed,
				cloud.root_look['ws-1'],
			)
			expect(shown?.find(xattr => xattr.name === 'cover')?.value).toBe('#222222')
		} finally {
			if (!store.is_disposed) store.dispose()
			cloud.root_look = saved
		}
	})
})

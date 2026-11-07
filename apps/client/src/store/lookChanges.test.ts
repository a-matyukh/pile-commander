import { afterEach, describe, expect, test } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import { createWorkspaceStore } from './createWorkspaceStore'

const opened: WorkspaceStore[] = []
afterEach(() => {
	for (const store of opened.splice(0)) store.dispose()
})

async function board(fail?: Error) {
	const fake = createFakeFileManager()
	fake.seed_folder('/')
	fake.seed_folder('/docs')
	let release: () => void = () => {}
	const gate = new Promise<void>(resolve => { release = resolve })
	const set = fake.fm.set_xattr.bind(fake.fm)
	fake.fm.set_xattr = async (id, name, value) => {
		await gate
		if (fail) throw fail
		return set(id, name, value)
	}
	const store = await createWorkspaceStore({ id: '/', type: 'cloud', name: 'ws' }, fake.fm, { root_folder_id: '/', live: false })
	if (!store) throw new Error('store did not open')
	opened.push(store)
	await store.show_folder_children('/docs', undefined, { silent: true })
	return { store, release }
}

const tile_cover = (store: WorkspaceStore) =>
	store.folders['/']!.children.find(child => child.id === '/docs')!.xattrs.find(xattr => xattr.name === 'cover')?.value

describe('a folder look change in the store', () => {
	test('the board tile shows the new cover before the write lands', async () => {
		const { store, release } = await board()
		const settled = store.change_folder_cover('/docs', '#D85A30')
		expect(tile_cover(store)).toBe('#D85A30')
		release()
		await settled
		expect(tile_cover(store)).toBe('#D85A30')
		expect(store.last_error).toBeNull()
	})

	test('a failed write puts back what the backend has, everywhere, and reports it', async () => {
		const { store, release } = await board(new Error('offline'))
		const settled = store.change_folder_cover('/docs', '#D85A30')
		expect(tile_cover(store)).toBe('#D85A30')
		release()
		await settled
		expect(tile_cover(store) ?? 'none').toBe('none')
		expect(store.last_error).toMatch(/offline/)
	})
})

describe('an image title or description in a cloud folder', () => {
	async function picture() {
		const fake = createFakeFileManager()
		fake.seed_folder('/')
		fake.seed_file('/pic.png')
		let release: () => void = () => {}
		const gate = new Promise<void>(resolve => { release = resolve })
		const set = fake.fm.set_xattr.bind(fake.fm)
		const remove = fake.fm.remove_xattr.bind(fake.fm)
		fake.fm.set_xattr = async (id, name, value) => {
			await gate
			return set(id, name, value)
		}
		fake.fm.remove_xattr = async (id, name) => {
			await gate
			return remove(id, name)
		}
		const store = await createWorkspaceStore({ id: '/', type: 'cloud', name: 'ws' }, fake.fm, { root_folder_id: '/', live: false })
		if (!store) throw new Error('store did not open')
		opened.push(store)
		return { store, fake, release }
	}

	const pic = (store: WorkspaceStore) =>
		store.folder_container.children.find(child => child.id === '/pic.png') as { title?: string } | undefined

	test('shows and clears before the write lands', async () => {
		const { store, fake, release } = await picture()
		const added = store.set_image_text('/pic.png', 'title', 'Sunset')
		expect(pic(store)?.title).toBe('Sunset')
		release()
		await added
		expect(fake.get_xattr('/pic.png', 'title')).toBe('Sunset')

		const cleared = store.set_image_text('/pic.png', 'title', '')
		expect(pic(store)?.title).toBeUndefined()
		await cleared
		expect(fake.get_xattr('/pic.png', 'title')).toBeNull()
		expect(store.last_error).toBeNull()
	})
})

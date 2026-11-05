import { afterEach, describe, expect, test } from 'vitest'
import { createFakeFileManager, type FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import { createWorkspaceStore } from './createWorkspaceStore'

const opened: WorkspaceStore[] = []
afterEach(() => {
	for (const store of opened.splice(0)) store.dispose()
})

const turn = () => new Promise(resolve => setTimeout(resolve, 0))

/**
 * A cloud store whose folder reads wait until the test releases them, and an
 * optional device copy of folders
 */
async function cloud_store(kept: Record<string, FolderWithChildrenXattrs> = {}) {
	const fake = createFakeFileManager()
	fake.seed_folder('/')
	fake.seed_folder('/one')
	fake.seed_file('/one/a.md', 'a')
	fake.set_xattr('/one/a.md', 'position', '{"x":1,"y":2}')
	fake.seed_folder('/two')
	fake.seed_file('/two/b.md', 'b')
	const read = fake.fm.folder_with_children_xattrs.bind(fake.fm)
	const gates = new Map<string, () => void>()
	let gating = false
	let reads = 0
	fake.fm.folder_with_children_xattrs = async (id: string) => {
		reads += 1
		if (gating) await new Promise<void>(resolve => gates.set(id, resolve))
		return read(id)
	}
	const store = await createWorkspaceStore({ id: 'ws', type: 'cloud', name: 'ws' }, fake.fm, {
		root_folder_id: '/',
		live: false,
		recall_folder: async folder_id => kept[folder_id] ? structuredClone(kept[folder_id]!) : null,
	})
	if (!store) throw new Error('store did not open')
	opened.push(store)
	const release = async (id: string) => {
		while (!gates.has(id)) await turn()
		const go = gates.get(id)!
		gates.delete(id)
		go()
		for (let i = 0; i < 5; i++) await turn()
	}
	return {
		fake,
		store,
		release,
		gate: (on: boolean) => { gating = on },
		reads: () => reads,
	}
}

describe('a cloud folder seen before shows at once', () => {
	test('back to a folder in memory: shown without waiting, read again behind it', async () => {
		const { store, release, gate, reads } = await cloud_store()
		await store.open_folder('/one', { skipHistory: true })
		await store.open_folder('/', { skipHistory: true })
		gate(true)
		const before = reads()
		// resolves while the cloud read is still held back
		await expect(store.open_folder('/one', { skipHistory: true })).resolves.toBe(true)
		expect(store.opened_folder_id).toBe('/one')
		expect(store.refreshing_folder_id).toBe('/one')
		expect(reads()).toBe(before + 1)
		await release('/one')
		expect(store.refreshing_folder_id).toBeNull()
	})

	test('the read behind it only reads: a key removed on another device stays removed', async () => {
		const { fake, store, release, gate } = await cloud_store()
		await store.open_folder('/one', { skipHistory: true })
		await store.open_folder('/', { skipHistory: true })
		// another device moves the card back to the pile: its position is gone
		await fake.fm.remove_xattr('/one/a.md', 'position')
		const calls = fake.calls.length
		gate(true)
		await store.open_folder('/one', { skipHistory: true })
		await release('/one')
		const card = store.folders['/one']!.children!.find(child => child.name === 'a.md')!
		expect(card.xattrs.find(xattr => xattr.name === 'position')).toBeUndefined()
		expect(fake.calls.slice(calls).map(call => call.method)).not.toContain('set_xattrs')
		expect(fake.get_xattr('/one/a.md', 'position')).toBeNull()
	})

	test('a folder this device kept shows before the cloud answers, then the cloud answer replaces it', async () => {
		const stale: FolderWithChildrenXattrs = {
			id: '/two',
			name: 'two',
			type: 'folder',
			xattrs: [],
			children: [
				{ id: '/two/b.md', name: 'b.md', type: 'file', xattrs: [] },
				{ id: '/two/gone.md', name: 'gone.md', type: 'file', xattrs: [] },
			],
		}
		const { store, release, gate } = await cloud_store({ '/two': stale })
		gate(true)
		await expect(store.open_folder('/two', { skipHistory: true })).resolves.toBe(true)
		expect(store.folders['/two']!.children!.map(child => child.name)).toEqual(['b.md', 'gone.md'])
		expect(store.refreshing_folder_id).toBe('/two')
		await release('/two')
		expect(store.folders['/two']!.children!.map(child => child.name)).toEqual(['b.md'])
		expect(store.refreshing_folder_id).toBeNull()
	})

	test('a folder deleted elsewhere while this device still had it: the error is said and its parent opens', async () => {
		const { fake, store, release, gate } = await cloud_store()
		await store.open_folder('/one', { skipHistory: true })
		await store.open_folder('/', { skipHistory: true })
		await fake.fm.remove('/one')
		gate(true)
		await store.open_folder('/one', { skipHistory: true })
		await release('/one')
		await release('/')
		expect(store.last_error).toBeTruthy()
		expect(store.opened_folder_id).toBe('/')
	})

	test('nothing kept: the open waits for the cloud as before', async () => {
		const { store, release, gate } = await cloud_store()
		gate(true)
		let done = false
		const going = store.open_folder('/two', { skipHistory: true }).then(result => { done = true; return result })
		for (let i = 0; i < 5; i++) await turn()
		expect(done).toBe(false)
		await release('/two')
		await expect(going).resolves.toBe(true)
		expect(store.refreshing_folder_id).toBeNull()
	})
})

describe('a folder opened from a view', () => {
	test('goes through the hook the Explorer sets, and back to the store without one', async () => {
		const { store } = await cloud_store()
		const asked: string[] = []
		store.set_open_folder_hook(folder_id => { asked.push(folder_id) })
		store.open({ id: '/one', name: 'one', type: 'folder', xattrs: [] } as never)
		expect(asked).toEqual(['/one'])
		expect(store.opened_folder_id).toBe('/')
		store.set_open_folder_hook(null)
		store.open({ id: '/one', name: 'one', type: 'folder', xattrs: [] } as never)
		for (let i = 0; i < 5; i++) await turn()
		expect(store.opened_folder_id).toBe('/one')
	})
})

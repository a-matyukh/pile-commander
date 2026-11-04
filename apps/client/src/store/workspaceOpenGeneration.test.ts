import { afterEach, describe, expect, test } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import { createWorkspaceStore } from './createWorkspaceStore'

const opened: WorkspaceStore[] = []
afterEach(() => {
	for (const store of opened.splice(0)) store.dispose()
})

/** A store whose folder reads wait until the test releases them, by folder */
async function gated() {
	const fake = createFakeFileManager()
	fake.seed_folder('/')
	fake.seed_folder('/one')
	fake.seed_folder('/two')
	const read = fake.fm.folder_with_children_xattrs.bind(fake.fm)
	const gates = new Map<string, () => void>()
	let gating = false
	fake.fm.folder_with_children_xattrs = async (id: string) => {
		if (gating) await new Promise<void>(resolve => gates.set(id, resolve))
		return read(id)
	}
	const store = await createWorkspaceStore({ id: '/', type: 'cloud', name: 'ws' }, fake.fm, { root_folder_id: '/', live: false })
	if (!store) throw new Error('store did not open')
	opened.push(store)
	gating = true
	const release = async (id: string) => {
		while (!gates.has(id)) await new Promise(resolve => setTimeout(resolve, 0))
		gates.get(id)!()
	}
	return { store, release }
}

describe('workspace store: a folder open that was overtaken', () => {
	test('the slower of two opens does not apply its folder and resolves false', async () => {
		const { store, release } = await gated()
		const slow = store.open_folder('/one', { skipHistory: true })
		const fast = store.open_folder('/two', { skipHistory: true })
		await release('/two')
		await expect(fast).resolves.toBe(true)
		await release('/one')
		await expect(slow).resolves.toBe(false)
		expect(store.opened_folder_id).toBe('/two')
	})

	test('cancel_open drops the open in flight', async () => {
		const { store, release } = await gated()
		const going = store.open_folder('/one', { skipHistory: true })
		store.cancel_open()
		expect(store.opening_folder_id).toBeNull()
		await release('/one')
		await expect(going).resolves.toBe(false)
		expect(store.opened_folder_id).toBe('/')
	})

	test('the folder already open resolves true without a read', async () => {
		const { store } = await gated()
		await expect(store.open_folder('/', { skipHistory: true })).resolves.toBe(true)
	})
})

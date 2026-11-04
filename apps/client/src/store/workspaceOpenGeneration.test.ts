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

describe('workspace store: the cloud watch goes live in the background', () => {
	async function gated_watch() {
		const fake = createFakeFileManager()
		fake.seed_folder('/')
		fake.seed_folder('/docs')
		const watch = fake.fm.watch.bind(fake.fm)
		let go_live: () => void = () => {}
		const live = new Promise<void>(resolve => { go_live = resolve })
		fake.fm.watch = async (...args: Parameters<typeof watch>) => {
			await live
			return watch(...args)
		}
		return { fake, go_live }
	}

	const until = async (check: () => boolean) => {
		for (let i = 0; i < 50 && !check(); i++) await new Promise(resolve => setTimeout(resolve, 0))
		expect(check()).toBe(true)
	}

	test('the store and its folders open before the watch is live; what changed meanwhile shows once it is', async () => {
		const { fake, go_live } = await gated_watch()
		const store = await createWorkspaceStore({ id: '/', type: 'cloud', name: 'ws' }, fake.fm, { root_folder_id: '/' })
		if (!store) throw new Error('store did not open')
		opened.push(store)
		await expect(store.open_folder('/docs', { skipHistory: true })).resolves.toBe(true)

		// another device adds a file while nothing is listening yet
		fake.seed_file('/docs/late.txt')
		expect(store.folders['/docs']!.children.map(child => child.id)).not.toContain('/docs/late.txt')

		go_live()
		await until(() => store.folders['/docs']!.children.some(child => child.id === '/docs/late.txt'))
	})

	test('a local store still waits for its watch', async () => {
		const { fake, go_live } = await gated_watch()
		let created = false
		const opening = createWorkspaceStore({ id: '/', type: 'local', name: 'disk' }, fake.fm, { root_folder_id: '/' })
			.then(store => { created = true; if (store) opened.push(store); return store })
		await new Promise(resolve => setTimeout(resolve, 0))
		expect(created).toBe(false)
		go_live()
		await opening
		expect(created).toBe(true)
	})
})

describe('folder_read_ticket', () => {
	test('an older read does not apply over a newer one; a store keeps its own order', async () => {
		const { folder_read_ticket } = await import('./helpers/refreshCachedFolder')
		const store = {}
		const older = folder_read_ticket(store, '/')
		const newer = folder_read_ticket(store, '/')
		expect(newer.is_latest()).toBe(true)
		newer.applied()
		expect(older.is_latest()).toBe(false)
		// another folder, another store: not affected
		expect(folder_read_ticket(store, '/docs').is_latest()).toBe(true)
		expect(folder_read_ticket({}, '/').is_latest()).toBe(true)
	})
})

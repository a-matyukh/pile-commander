import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import { gate_pending_entries } from '@/services/cloud/pendingEntries'
import { t } from '@/i18n'
import { createWorkspaceStore } from './createWorkspaceStore'
import { refresh_cached_folder } from './helpers/refreshCachedFolder'

const opened: WorkspaceStore[] = []
afterEach(() => {
	for (const store of opened.splice(0)) store.dispose()
	vi.restoreAllMocks()
})

const turn = () => new Promise(resolve => setTimeout(resolve, 0))
const settle = async () => {
	for (let i = 0; i < 10; i++) await turn()
}

/** A cloud store whose create and rename requests wait until the test lets them go (or refuses them) */
async function cloud_store() {
	vi.spyOn(console, 'error').mockImplementation(() => {})
	const fake = createFakeFileManager()
	fake.seed_folder('/')
	fake.seed_folder('/docs')
	const fm = gate_pending_entries(fake.fm)
	const waiting: { go: () => void; refuse: (error: Error) => void }[] = []
	const held = <A extends unknown[], R>(original: (...args: A) => Promise<R>) => (...args: A) =>
		new Promise<R>((resolve, reject) => {
			waiting.push({
				go: () => { original(...args).then(resolve, reject) },
				refuse: reject,
			})
		})
	const create_folder = fake.fm.create_folder.bind(fake.fm)
	const rename = fake.fm.rename.bind(fake.fm)
	const store = await createWorkspaceStore({ id: 'ws', type: 'cloud', name: 'ws' }, fm, { root_folder_id: '/', live: false })
	if (!store) throw new Error('store did not open')
	opened.push(store)
	return { fake, fm, store, waiting, held, create_folder, rename }
}

const names = (store: WorkspaceStore, folder = '/') => (store.folders[folder]?.children ?? []).map(child => child.name).sort()
/** The name the store gave the new folder ("New folder 1", "Новая папка 1", …) */
const created = (store: WorkspaceStore) => names(store).find(name => name.startsWith(t('add.new_folder_name')))

describe('a cloud folder created or renamed shows at once', () => {
	test('a new folder is on screen before the cloud answers, and stays once it does', async () => {
		const { fake, store, waiting, held, create_folder } = await cloud_store()
		;(fake.fm as { create_folder: unknown }).create_folder = held(create_folder)
		const going = store.create_folder('/')
		await settle()
		const name = created(store)!
		expect(name).toBeTruthy()
		expect(fake.has(`/${name}`)).toBe(false)
		waiting.shift()!.go()
		await expect(going).resolves.toBe(`/${name}`)
		expect(created(store)).toBe(name)
		expect(fake.has(`/${name}`)).toBe(true)
	})

	test('a refused folder goes away again and the reason is said', async () => {
		const { fake, store, waiting, held, create_folder } = await cloud_store()
		;(fake.fm as { create_folder: unknown }).create_folder = held(create_folder)
		const going = store.create_folder('/')
		await settle()
		waiting.shift()!.refuse(new Error('Failed to fetch'))
		await expect(going).resolves.toBe('')
		expect(created(store)).toBeUndefined()
		expect(store.last_error).toBeTruthy()
	})

	test('a call that names the new folder waits for it: it never reaches the cloud first', async () => {
		const { fake, store, waiting, held, create_folder } = await cloud_store()
		;(fake.fm as { create_folder: unknown }).create_folder = held(create_folder)
		const going = store.create_folder('/')
		await settle()
		let done = false
		const name = created(store)!
		const writing = store.file_manager.set_xattr(`/${name}`, 'icon', 'star')
			.finally(() => { done = true })
		await settle()
		// not refused as "not found": it is waiting for the folder
		expect(done).toBe(false)
		waiting.shift()!.go()
		await going
		await writing
		expect(fake.get_xattr(`/${name}`, 'icon')).toBe('star')
	})

	test('a read of the parent that lands meanwhile keeps the folder it does not see yet', async () => {
		const { fake, fm, store, waiting, held, create_folder } = await cloud_store()
		;(fake.fm as { create_folder: unknown }).create_folder = held(create_folder)
		const going = store.create_folder('/')
		await settle()
		const name = created(store)
		await refresh_cached_folder(store as never, fm, '/', { kind: 'modify', ids: ['/'] })
		expect(created(store)).toBe(name)
		waiting.shift()!.go()
		await going
	})

	test('a rename shows at once; a refusal puts the old name back and says why', async () => {
		const { fake, store, waiting, held, rename } = await cloud_store()
		;(fake.fm as { rename: unknown }).rename = held(rename)
		const first = store.rename('/docs', 'notes')
		await settle()
		expect(names(store)).toEqual(['notes'])
		waiting.shift()!.go()
		await first
		expect(names(store)).toEqual(['notes'])
		expect(fake.has('/notes')).toBe(true)

		const second = store.rename('/notes', 'taken')
		await settle()
		expect(names(store)).toEqual(['taken'])
		waiting.shift()!.refuse(new Error('an entry with this name already exists'))
		await second
		expect(names(store)).toEqual(['notes'])
		expect(store.last_error).toContain('already exists')
	})

	test('a read of the parent during a rename does not bring the old name back', async () => {
		const { fake, fm, store, waiting, held, rename } = await cloud_store()
		;(fake.fm as { rename: unknown }).rename = held(rename)
		const going = store.rename('/docs', 'notes')
		await settle()
		await refresh_cached_folder(store as never, fm, '/', { kind: 'modify', ids: ['/'] })
		expect(names(store)).toEqual(['notes'])
		waiting.shift()!.go()
		await going
	})
})

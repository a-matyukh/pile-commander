import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeFileManager, type FileManager } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import {
	BROWSER_ROOT,
	create_explorer_drives,
	explorer_local_file_manager_options,
	is_within,
	type ExplorerDriveDeps,
} from './drives'
import { explorer_language } from './language'

const HOME = '/Users/me'

function track_watches(fm: FileManager) {
	const watch = fm.watch.bind(fm)
	const active = new Map<string, boolean>()
	fm.watch = async (folder_id, on_event, options) => {
		const unwatch = await watch(folder_id, on_event, options)
		active.set(folder_id, options?.recursive === true)
		return () => {
			active.delete(folder_id)
			unwatch()
		}
	}
	return active
}

function fake_store(): WorkspaceStore {
	return { dispose: vi.fn() } as unknown as WorkspaceStore
}

function deps(over: Partial<ExplorerDriveDeps> = {}): ExplorerDriveDeps {
	return {
		is_desktop: true,
		home_path: async () => HOME,
		local_file_manager: () => createFakeFileManager().fm,
		open_cloud: async () => fake_store(),
		cloud_roots: async () => [],
		browser_file_manager: async () => createFakeFileManager().fm,
		adopt: () => {},
		...over,
	}
}

describe('explorer drives', () => {
	beforeEach(() => {
		explorer_language.value = 'en'
	})

	test('the new local file manager is the only one that deletes to the system trash', () => {
		expect(explorer_local_file_manager_options).toEqual({ remove_to_trash: true })
		const open_store = readFileSync(fileURLToPath(new URL('../helpers/openWorkspaceStore.ts', import.meta.url)), 'utf8')
		expect(open_store).not.toContain('remove_to_trash')
	})

	test('a path inside ~ belongs to the home root, and a volume does not', () => {
		expect(is_within('/Users/me/Documents', HOME)).toBe(true)
		expect(is_within(`${HOME}/`, HOME)).toBe(true)
		expect(is_within('/Volumes/Disk', HOME)).toBe(false)
	})

	test('local roots use a shallow watch, and a volume is its own root while it is current', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/Documents`)
		fake.seed_folder('/Volumes/Disk')
		const watches = track_watches(fake.fm)
		const drives = create_explorer_drives(deps({
			local_file_manager: () => fake.fm,
		}))

		expect((await drives.drives().find(drive => drive.id === 'local')!.roots()).map(root => root.id)).toEqual([HOME])

		const home_store = await drives.open('local', HOME)
		expect(watches.get(HOME)).toBe(false)

		const disk_store = await drives.open_local_path('/Volumes/Disk')
		expect(disk_store).not.toBe(home_store)
		expect(watches.get('/Volumes/Disk')).toBe(false)
		expect((await drives.drives()[0]!.roots()).map(root => root.id)).toEqual([HOME, '/Volumes/Disk'])

		const dispose_disk = vi.spyOn(disk_store, 'dispose')
		await drives.open('local', HOME)
		expect(dispose_disk).toHaveBeenCalled()
		expect((await drives.drives()[0]!.roots()).map(root => root.id)).toEqual([HOME])
	})

	test('an open that has already lost does not become the current root', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder('/Volumes/Disk')
		let current: WorkspaceStore | null = null
		const drives = create_explorer_drives(deps({
			local_file_manager: () => fake.fm,
			adopt: (workspace) => { current = workspace },
		}))

		await drives.open('local', HOME, () => false)
		expect(current).toBeNull()

		const disk = await drives.open('local', '/Volumes/Disk', () => true)
		expect(current).toBe(disk)
		expect(disk.id).toBe('/Volumes/Disk')
	})

	test('an expanded volume stays open after the current place moves home', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder('/Volumes/Disk')
		const drives = create_explorer_drives(deps({
			local_file_manager: () => fake.fm,
		}))

		const disk_store = await drives.open_local_path('/Volumes/Disk')
		drives.set_expanded(['/Volumes/Disk'])
		await drives.open('local', HOME)

		expect(await drives.open('local', '/Volumes/Disk')).toBe(disk_store)
	})

	test('leaving the demo for another drive closes it; the tree\'s drive keeps its expanded roots', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		const demo = fake_store()
		const drives = create_explorer_drives(deps({
			local_file_manager: () => fake.fm,
			open_demo: async () => demo,
		}))

		await drives.open('demo', '/demo')
		drives.set_expanded(['/demo'], 'demo')
		await drives.open('local', HOME)
		// the tree still shows the demo: its root stays open
		expect(demo.dispose).not.toHaveBeenCalled()

		drives.set_expanded([HOME], 'local')
		expect(demo.dispose).toHaveBeenCalledTimes(1)
	})

	test('a held root stays open through a sweep and closes on release', async () => {
		const stores = new Map<string, WorkspaceStore>()
		const drives = create_explorer_drives(deps({
			cloud_roots: async () => [
				{ id: 'ws-1', name: 'One', can_write: true },
				{ id: 'ws-2', name: 'Two', can_write: true },
			],
			open_cloud: async (item) => {
				const store = fake_store()
				stores.set(item.id, store)
				return store
			},
		}))
		const cloud = drives.drives().find(drive => drive.kind === 'cloud')!
		await drives.open('cloud', 'ws-1')
		const release = drives.hold('ws-2')
		const held = await cloud.store_for('ws-2')

		drives.set_expanded([])
		expect(held.dispose).not.toHaveBeenCalled()

		release()
		expect(held.dispose).toHaveBeenCalledTimes(1)
		// A second release is a no-op; the current root stays
		release()
		expect(stores.get('ws-1')!.dispose).not.toHaveBeenCalled()
	})

	test('cloud roots come from the workspace list and reuse one store', async () => {
		const opened: WorkspacesListItem[] = []
		const cloud_store = fake_store()
		const drives = create_explorer_drives(deps({
			cloud_roots: async () => [
				{ id: 'ws-1', name: 'Notes', can_write: true },
				{ id: 'ws-2', name: 'Shared', can_write: false },
			],
			open_cloud: async (item) => {
				opened.push(item)
				return cloud_store
			},
		}))
		const cloud_drive = drives.drives().find(drive => drive.kind === 'cloud')!
		expect(cloud_drive.trash).toBe('page')
		expect(await cloud_drive.roots()).toEqual([
			{ id: 'ws-1', name: 'Notes', can_write: true },
			{ id: 'ws-2', name: 'Shared', can_write: false },
		])

		expect(await cloud_drive.store_for('ws-1')).toBe(cloud_store)
		expect(await cloud_drive.store_for('ws-1')).toBe(cloud_store)
		expect(opened).toEqual([{ id: 'ws-1', type: 'cloud', name: 'Notes' }])
	})

	test('the browser drive has one root and does not watch it as a whole disk', async () => {
		const browser = createFakeFileManager()
		browser.seed_folder(BROWSER_ROOT)
		const watches = track_watches(browser.fm)
		let managers = 0
		const drives = create_explorer_drives(deps({
			is_desktop: false,
			browser_file_manager: async () => {
				managers += 1
				return browser.fm
			},
		}))
		const drive = drives.drives().find(item => item.kind === 'browser')!
		expect(drive.trash).toBeNull()
		expect(await drive.roots()).toEqual([
			{ id: BROWSER_ROOT, name: 'Browser storage', can_write: true },
		])

		const first = await drive.store_for(BROWSER_ROOT)
		const second = await drive.store_for(BROWSER_ROOT)
		expect(second).toBe(first)
		expect(managers).toBe(1)
		expect(watches.get(BROWSER_ROOT)).toBe(true)
	})

	test('dispose_all closes held stores and the next open creates a new one', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		const drives = create_explorer_drives(deps({
			local_file_manager: () => fake.fm,
		}))
		const first = await drives.open('local', HOME)
		drives.dispose_all()
		expect(first.is_disposed).toBe(true)

		const second = await drives.open('local', HOME)
		expect(second).not.toBe(first)
		expect(second.is_disposed).toBe(false)
	})

	test('a store closed from outside is dropped and opened again', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		const drives = create_explorer_drives(deps({
			local_file_manager: () => fake.fm,
		}))
		const first = await drives.open('local', HOME)
		first.dispose()

		const second = await drives.open('local', HOME)
		expect(second).not.toBe(first)
		expect(second.is_disposed).toBe(false)
	})
})

describe('explorer drives: prepare (a root opened for a transition, shown on commit)', () => {
	beforeEach(() => {
		explorer_language.value = 'en'
	})

	function tracked() {
		const created: Record<string, WorkspaceStore & { disposed: boolean }> = {}
		const adopted: (WorkspaceStore | null)[] = []
		const drives = create_explorer_drives(deps({
			cloud_roots: async () => ['a', 'b'].map(id => ({ id, name: id, can_write: true })),
			async open_cloud(item: WorkspacesListItem) {
				const store = {
					disposed: false,
					get is_disposed() { return this.disposed },
					dispose() { this.disposed = true },
				} as unknown as WorkspaceStore & { disposed: boolean }
				created[item.id] = store
				return store
			},
			adopt: store => { adopted.push(store) },
		}))
		return { drives, created, adopted }
	}

	test('nothing changes on screen until commit; commit shows it and closes the root it left', async () => {
		const { drives, created, adopted } = tracked()
		const a = await drives.prepare('cloud', 'a')
		expect(a.commit()).toBe(true)
		expect(adopted).toEqual([created.a])

		const b = await drives.prepare('cloud', 'b')
		expect(adopted).toEqual([created.a])
		expect(created.a!.disposed).toBe(false)
		expect(b.commit()).toBe(true)
		expect(adopted).toEqual([created.a, created.b])
		expect(created.a!.disposed).toBe(true)
		expect(b.commit()).toBe(false)
	})

	test('a released transition closes the store it opened and leaves the root on screen', async () => {
		const { drives, created, adopted } = tracked()
		;(await drives.prepare('cloud', 'a')).commit()
		const b = await drives.prepare('cloud', 'b')
		b.release()
		expect(created.b!.disposed).toBe(true)
		expect(created.a!.disposed).toBe(false)
		expect(adopted).toEqual([created.a])
	})

	test('two transitions share a new store: the one that loses does not close it under the winner', async () => {
		const { drives, created, adopted } = tracked()
		;(await drives.prepare('cloud', 'a')).commit()
		const [first, second] = await Promise.all([drives.prepare('cloud', 'b'), drives.prepare('cloud', 'b')])
		expect(first.store).toBe(second.store)
		first.release()
		expect(created.b!.disposed).toBe(false)
		expect(second.commit()).toBe(true)
		expect(adopted.at(-1)).toBe(created.b)
	})

	test('a transition that lost meanwhile does not show its root', async () => {
		const { drives, created, adopted } = tracked()
		;(await drives.prepare('cloud', 'a')).commit()
		const b = await drives.prepare('cloud', 'b')
		expect(b.commit(() => false)).toBe(false)
		expect(adopted).toEqual([created.a])
		expect(created.b!.disposed).toBe(true)
	})

	test('closing every drive in between: commit refuses', async () => {
		const { drives, adopted } = tracked()
		const a = await drives.prepare('cloud', 'a')
		drives.dispose_all()
		expect(a.commit()).toBe(false)
		expect(adopted).toEqual([])
	})
})

describe('explorer drives: a cloud root opens by its name alone', () => {
	test('the root list with its look-ahead reads is not needed to open one root', async () => {
		const cloud_roots = vi.fn(async () => [{ id: 'a', name: 'From roots', can_write: true }])
		const opened: WorkspacesListItem[] = []
		const drives = create_explorer_drives(deps({
			cloud_roots,
			cloud_root_name: async () => 'From the list',
			async open_cloud(item) {
				opened.push(item)
				return { dispose: vi.fn(), is_disposed: false } as unknown as WorkspaceStore
			},
		}))
		await drives.open('cloud', 'a')
		expect(cloud_roots).not.toHaveBeenCalled()
		expect(opened[0]?.name).toBe('From the list')
	})
})

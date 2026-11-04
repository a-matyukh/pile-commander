import { describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { PreparedRoot } from './drives'
import { create_explorer_navigation, type ExplorerNavigation } from './navigation'

/** A store whose folder opens wait until the test lets them land (or fail) */
function gated_store(root: string) {
	const pending = new Map<string, { land(): void; fail(error: Error): void }>()
	let generation = 0
	const store = {
		id: root,
		opened_folder_id: root,
		is_disposed: false,
		selection: [] as string[],
		selection_mode: false,
		opened_folder: { children: [] as { id: string }[] },
		exit_selection_mode() {},
		enter_selection_mode() {},
		set_selection() {},
		cancel_open: vi.fn(() => { generation += 1 }),
		open_folder: vi.fn((folder_id: string) => {
			const mine = ++generation
			return new Promise<boolean>((resolve, reject) => {
				pending.set(folder_id, {
					land() {
						if (mine !== generation) return resolve(false)
						store.opened_folder_id = folder_id
						resolve(true)
					},
					fail: reject,
				})
			})
		}),
	}
	return { store, pending }
}

type Gated = ReturnType<typeof gated_store>

function setup() {
	const stores = new Map<string, Gated>()
	const prepared: { root_id: string; commit: ReturnType<typeof vi.fn>; release: ReturnType<typeof vi.fn> }[] = []
	let current: Gated['store'] | null = null
	const gated = (root_id: string) => {
		let found = stores.get(root_id)
		if (!found) {
			found = gated_store(root_id)
			stores.set(root_id, found)
		}
		return found
	}
	const nav = create_explorer_navigation({
		async open_root() { throw new Error('the navigation must prepare, not open') },
		async prepare_root(_drive_id, root_id): Promise<PreparedRoot> {
			const { store } = gated(root_id)
			const entry = {
				root_id,
				commit: vi.fn((still_current?: () => boolean) => {
					if (still_current && !still_current()) return false
					current = store
					return true
				}),
				release: vi.fn(),
			}
			prepared.push(entry)
			return { store: store as unknown as WorkspaceStore, commit: entry.commit, release: entry.release }
		},
		current_store: () => current as unknown as WorkspaceStore | null,
		async default_folder() { return { drive_id: 'cloud', root_id: 'a', folder_id: '/' } },
		async home_path() { return '/Users/me' },
		last_location: ref<FolderRef | null>(null),
		after_launch_settles: () => {},
	})
	return { nav, gated, prepared, current: () => current }
}

const cloud = (root_id: string, folder_id: string): FolderRef => ({ drive_id: 'cloud', root_id, folder_id })

function folder_of(nav: ExplorerNavigation): string | null {
	const location = nav.location
	return location?.kind === 'folder' ? `${location.ref.root_id}:${location.ref.folder_id}` : null
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function at_root_a(world: ReturnType<typeof setup>) {
	// a root folder is already open in its store: no folder read
	world.gated('a').store.opened_folder_id = '/'
	await world.nav.open_folder(cloud('a', '/'))
	expect(folder_of(world.nav)).toBe('a:/')
}

describe('explorer navigation: a cloud folder that is opening', () => {
	test('is the target at once; location, the root on screen and history change only when it has opened', async () => {
		const world = setup()
		await at_root_a(world)
		const going = world.nav.open_folder(cloud('b', '/docs'))
		await settle()
		expect(world.nav.target).toEqual({ kind: 'folder', ref: cloud('b', '/docs') })
		expect(folder_of(world.nav)).toBe('a:/')
		expect(world.current()).toBe(world.gated('a').store)
		expect(world.nav.can_go_back).toBe(true)

		world.gated('b').pending.get('/docs')!.land()
		await going
		expect(world.nav.target).toBeNull()
		expect(folder_of(world.nav)).toBe('b:/docs')
		expect(world.current()).toBe(world.gated('b').store)
		expect(world.prepared.at(-1)!.commit).toHaveBeenCalledOnce()
		expect(world.prepared.at(-1)!.release).not.toHaveBeenCalled()
	})

	test('a folder that fails to open leaves everything where it was', async () => {
		const world = setup()
		await at_root_a(world)
		const going = world.nav.open_folder(cloud('b', '/docs'))
		await settle()
		world.gated('b').pending.get('/docs')!.fail(new Error('offline'))
		await expect(going).rejects.toThrow()
		expect(world.nav.target).toBeNull()
		expect(folder_of(world.nav)).toBe('a:/')
		expect(world.current()).toBe(world.gated('a').store)
		expect(world.prepared.at(-1)!.commit).not.toHaveBeenCalled()
		expect(world.prepared.at(-1)!.release).toHaveBeenCalledOnce()
	})

	test('back while it opens drops it and stays; its late answer changes nothing', async () => {
		const world = setup()
		await at_root_a(world)
		const going = world.nav.open_folder(cloud('b', '/docs'))
		await settle()
		await world.nav.go_back()
		expect(world.nav.target).toBeNull()
		expect(folder_of(world.nav)).toBe('a:/')
		expect(world.gated('a').store.cancel_open).toHaveBeenCalled()

		world.gated('b').pending.get('/docs')!.land()
		await going
		expect(folder_of(world.nav)).toBe('a:/')
		expect(world.current()).toBe(world.gated('a').store)
		expect(world.prepared.at(-1)!.release).toHaveBeenCalledOnce()
		expect(world.nav.can_go_back).toBe(false)
	})

	test('clicking the folder on screen while another opens: stay here', async () => {
		const world = setup()
		await at_root_a(world)
		const going = world.nav.open_folder(cloud('b', '/docs'))
		await settle()
		await world.nav.open_folder(cloud('a', '/'))
		expect(world.nav.target).toBeNull()
		world.gated('b').pending.get('/docs')!.land()
		await going
		expect(folder_of(world.nav)).toBe('a:/')
	})

	test('two folders of one root: the slower first one does not win over the later one', async () => {
		const world = setup()
		await at_root_a(world)
		const slow = world.nav.open_folder(cloud('a', '/one'))
		await settle()
		const fast = world.nav.open_folder(cloud('a', '/two'))
		await settle()
		expect(world.nav.target).toEqual({ kind: 'folder', ref: cloud('a', '/two') })
		const { pending } = world.gated('a')
		pending.get('/two')!.land()
		await fast
		pending.get('/one')!.land()
		await slow
		expect(folder_of(world.nav)).toBe('a:/two')
		expect(world.gated('a').store.opened_folder_id).toBe('/two')
		expect(world.nav.target).toBeNull()
	})

	test('a local folder has no target: it opens faster than a placeholder would show', async () => {
		const world = setup()
		const local = world.gated('/Users/me')
		const going = world.nav.open_folder({ drive_id: 'local', root_id: '/Users/me', folder_id: '/Users/me/docs' })
		await settle()
		expect(world.nav.target).toBeNull()
		local.pending.get('/Users/me/docs')!.land()
		await going
		expect(folder_of(world.nav)).toBe('/Users/me:/Users/me/docs')
	})
})

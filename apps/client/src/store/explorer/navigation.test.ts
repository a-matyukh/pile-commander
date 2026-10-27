import { afterEach, describe, expect, test, vi } from 'vitest'
import { ref } from 'vue'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { createWorkspaceStore } from '@/store/createWorkspaceStore'
import { create_explorer_drives } from './drives'
import {
	EXPLORER_LAST_LOCATION_KEY,
	create_explorer_navigation,
	read_folder_ref,
	type ExplorerNavigation,
	type ExplorerNavigationDeps,
} from './navigation'

const HOME = '/Users/me'
const lingering: WorkspaceStore[] = []

afterEach(() => {
	for (const workspace of lingering) workspace.dispose()
	lingering.length = 0
})

function attach(workspace: WorkspaceStore): WorkspaceStore {
	const open_folder = workspace.open_folder.bind(workspace)
	vi.spyOn(workspace, 'open_folder').mockImplementation((folder_id, options) => {
		expect(options).toEqual({ skipHistory: true })
		return open_folder(folder_id, options)
	})
	vi.spyOn(workspace, 'go_back')
	lingering.push(workspace)
	return workspace
}

function setup() {
	const fake = createFakeFileManager()
	fake.seed_folder(HOME)
	fake.seed_folder(`${HOME}/docs`)
	fake.seed_folder(`${HOME}/docs/sub`)
	fake.seed_file(`${HOME}/docs/a.txt`)
	fake.seed_folder(`${HOME}/pics`)
	fake.seed_file(`${HOME}/note.txt`)
	fake.seed_folder('/')
	fake.seed_folder('/docs')
	fake.seed_file('/docs/a.txt')
	fake.seed_folder('/Volumes/Disk')

	const stores = new Map<string, WorkspaceStore>()
	let current: WorkspaceStore | null = null
	const last = ref<FolderRef | null>(null)

	const deps: ExplorerNavigationDeps = {
		async open_root(drive_id, root_id) {
			const key = `${drive_id}\0${root_id}`
			let existing = stores.get(key)
			if (!existing || existing.is_disposed) {
				const created = await createWorkspaceStore(
					{ id: root_id, type: 'local', name: root_id },
					fake.fm,
					{ root_folder_id: drive_id === 'cloud' ? '/' : root_id },
				)
				if (!created) throw new Error(`failed to open ${root_id}`)
				existing = attach(created)
				stores.set(key, existing)
			}
			current = existing
			return existing
		},
		current_store: () => current,
		async default_folder() {
			return { drive_id: 'local', root_id: HOME, folder_id: HOME }
		},
		async home_path() { return HOME },
		last_location: last,
	}

	return {
		nav: create_explorer_navigation(deps),
		open_root: deps.open_root,
		last,
		stores,
		fake,
		current: () => current,
	}
}

function folder_of(nav: ExplorerNavigation): string {
	const location = nav.location
	if (!location || location.kind !== 'folder') throw new Error('expected a folder')
	return location.ref.folder_id
}

describe('explorer navigation', () => {
	test('reads a folder address and drops anything else', () => {
		expect(EXPLORER_LAST_LOCATION_KEY).toBe('pile_commander_explorer_location')
		expect(read_folder_ref('')).toBeNull()
		expect(read_folder_ref('nope')).toBeNull()
		expect(read_folder_ref('null')).toBeNull()
		expect(read_folder_ref('{"drive_id":"local"}')).toBeNull()
		expect(read_folder_ref(JSON.stringify({
			drive_id: 'local',
			root_id: HOME,
			folder_id: `${HOME}/docs`,
		}))).toEqual({
			drive_id: 'local',
			root_id: HOME,
			folder_id: `${HOME}/docs`,
		})
	})

	test('opens the saved folder at launch, or the default root when nothing is saved', async () => {
		const first = setup()
		await first.nav.open_at_launch()
		expect(first.nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'local', root_id: HOME, folder_id: HOME },
		})
		expect(first.nav.can_go_back).toBe(false)
		expect(first.last.value?.folder_id).toBe(HOME)
		await first.nav.go_back()
		await first.nav.go_forward()
		expect(folder_of(first.nav)).toBe(HOME)

		const saved = setup()
		saved.last.value = { drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` }
		await saved.nav.open_at_launch()
		expect(saved.current()!.opened_folder_id).toBe(`${HOME}/docs`)
		expect(saved.nav.can_go_back).toBe(false)
		expect(saved.current()!.can_go_back).toBe(false)
		expect(saved.current()!.go_back).not.toHaveBeenCalled()
	})

	test('a saved folder that is gone opens the root of its drive', async () => {
		const local = setup()
		local.last.value = { drive_id: 'local', root_id: HOME, folder_id: `${HOME}/gone` }
		await local.nav.open_at_launch()
		expect(local.nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'local', root_id: HOME, folder_id: HOME },
		})
		expect(local.last.value?.folder_id).toBe(HOME)
		expect(local.nav.can_go_back).toBe(false)
		expect(local.current()!.can_go_back).toBe(false)

		const cloud = setup()
		cloud.last.value = { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/gone' }
		await cloud.nav.open_at_launch()
		expect(cloud.nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/' },
		})
		expect(cloud.current()!.id).toBe('/')
		expect(cloud.current()!.opened_folder_id).toBe('/')
		expect(cloud.current()!.go_back).not.toHaveBeenCalled()
	})

	test('back and forward cross folders without using the store stack', async () => {
		const { nav, stores, current } = setup()
		await nav.open_at_launch()
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` })
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` })
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs/sub` })

		await nav.go_back()
		expect(folder_of(nav)).toBe(`${HOME}/docs`)
		expect(current()!.selection).toEqual([`${HOME}/docs/sub`])

		await nav.go_back()
		expect(folder_of(nav)).toBe(HOME)
		expect(current()!.selection).toEqual([`${HOME}/docs`])
		expect(nav.can_go_back).toBe(false)

		await nav.go_forward()
		expect(folder_of(nav)).toBe(`${HOME}/docs`)
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/pics` })
		expect(nav.can_go_forward).toBe(false)
		await nav.go_back()
		expect(folder_of(nav)).toBe(`${HOME}/docs`)
		await nav.go_forward()
		expect(folder_of(nav)).toBe(`${HOME}/pics`)

		const workspace = stores.get(`local\0${HOME}`)!
		expect(workspace.go_back).not.toHaveBeenCalled()
		expect(workspace.folder_back_stack).toEqual([])
		expect(workspace.can_go_back).toBe(false)
	})

	test('back returns across drives and still does not call the store back stack', async () => {
		const { nav, stores } = setup()
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` })
		await nav.open_folder({ drive_id: 'cloud', root_id: 'ws-1', folder_id: '/docs' })
		expect(nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/docs' },
		})

		await nav.go_back()
		expect(nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` },
		})

		const local = stores.get(`local\0${HOME}`)!
		const cloud = stores.get('cloud\0ws-1')!
		expect(local.go_back).not.toHaveBeenCalled()
		expect(cloud.go_back).not.toHaveBeenCalled()
		expect(local.folder_back_stack).toEqual([])
		expect(cloud.folder_back_stack).toEqual([])
		expect(local.opened_folder_id).toBe(`${HOME}/docs`)
		expect(cloud.opened_folder_id).toBe('/docs')
	})

	test('going back reopens a store that was closed', async () => {
		const { nav, stores } = setup()
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` })
		await nav.open_folder({ drive_id: 'cloud', root_id: 'ws-1', folder_id: '/docs' })
		const local = stores.get(`local\0${HOME}`)!
		local.dispose()

		await nav.go_back()
		const reopened = stores.get(`local\0${HOME}`)!
		expect(reopened).not.toBe(local)
		expect(reopened.opened_folder_id).toBe(`${HOME}/docs`)
		expect(reopened.go_back).not.toHaveBeenCalled()
		expect(reopened.folder_back_stack).toEqual([])
	})

	test('returning to a parent selects the folder that was left', async () => {
		const { nav, current } = setup()
		await nav.open_at_launch()
		current()!.set_selection([`${HOME}/note.txt`])
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs/sub` })
		await nav.go_back()
		expect(folder_of(nav)).toBe(HOME)
		expect(current()!.selection).toEqual([`${HOME}/docs`])
		expect(current()!.selection_mode).toBe(false)
		expect(current()!.go_back).not.toHaveBeenCalled()
	})

	test('returning from a page restores the selection', async () => {
		const { nav, current } = setup()
		await nav.open_at_launch()
		const workspace = current()!
		workspace.enter_selection_mode()
		workspace.set_selection([`${HOME}/note.txt`, `${HOME}/missing`])
		await nav.open_page('settings')
		expect(nav.location).toEqual({ kind: 'page', page: 'settings' })

		await nav.go_back()
		expect(folder_of(nav)).toBe(HOME)
		expect(workspace.selection).toEqual([`${HOME}/note.txt`])
		expect(workspace.selection_mode).toBe(true)

		await nav.go_forward()
		expect(nav.location).toEqual({ kind: 'page', page: 'settings' })
		expect(workspace.go_back).not.toHaveBeenCalled()
	})

	test('a path inside ~ opens that folder, and a path outside is its own root', async () => {
		const { nav } = setup()
		await nav.open_local_path(`${HOME}/docs/`)
		expect(nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` },
		})
		await nav.open_local_path('/Volumes/Disk')
		expect(nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'local', root_id: '/Volumes/Disk', folder_id: '/Volumes/Disk' },
		})
	})

	test('opening a missing folder stays on the current place', async () => {
		const { nav } = setup()
		await nav.open_at_launch()
		await expect(nav.open_folder({
			drive_id: 'local',
			root_id: HOME,
			folder_id: `${HOME}/gone`,
		})).rejects.toThrow(/no entry at/)
		expect(folder_of(nav)).toBe(HOME)
	})

	test('a bookmark to a missing folder opens that drive root', async () => {
		const { nav } = setup()
		await nav.open_at_launch()
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` })
		await expect(nav.open_bookmark({
			drive_id: 'local',
			root_id: HOME,
			folder_id: `${HOME}/gone`,
		})).resolves.toBeUndefined()
		expect(folder_of(nav)).toBe(HOME)
		expect(nav.can_go_back).toBe(true)
	})

	test('a bookmark whose drive cannot be opened is reported and does not move', async () => {
		const base = setup()
		const reported: string[] = []
		const nav = create_explorer_navigation({
			open_root(drive_id, root_id, still_current) {
				if (drive_id === 'cloud') throw new Error('No access to workspace “ws-gone”')
				return base.open_root(drive_id, root_id, still_current)
			},
			current_store: () => base.current(),
			async default_folder() {
				return { drive_id: 'local', root_id: HOME, folder_id: HOME }
			},
			async home_path() { return HOME },
			last_location: base.last,
			on_error(error) {
				reported.push(error instanceof Error ? error.message : String(error))
			},
		})
		await nav.open_at_launch()
		await expect(nav.open_bookmark({
			drive_id: 'cloud',
			root_id: 'ws-gone',
			folder_id: '/',
		})).resolves.toBeUndefined()
		expect(reported).toEqual(['No access to workspace “ws-gone”'])
		expect(folder_of(nav)).toBe(HOME)
	})

	test('a slower first open loses to the folder opened after it', async () => {
		const base = setup()
		let release_first!: () => void
		const first_gate = new Promise<void>(resolve => { release_first = resolve })
		let calls = 0
		const nav = create_explorer_navigation({
			async open_root(drive_id, root_id, still_current) {
				calls += 1
				if (calls === 1) await first_gate
				return base.open_root(drive_id, root_id, still_current)
			},
			current_store: () => base.current(),
			async default_folder() {
				return { drive_id: 'local', root_id: HOME, folder_id: HOME }
			},
			async home_path() { return HOME },
			last_location: base.last,
		})

		const first = nav.open_folder({
			drive_id: 'local',
			root_id: HOME,
			folder_id: `${HOME}/docs`,
		})
		const second = nav.open_folder({
			drive_id: 'cloud',
			root_id: 'ws-1',
			folder_id: '/docs',
		})
		await second
		release_first()
		await first

		expect(nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/docs' },
		})
		expect(nav.can_go_back).toBe(false)
		expect(base.last.value).toEqual({
			drive_id: 'cloud',
			root_id: 'ws-1',
			folder_id: '/docs',
		})
		expect(base.stores.get(`local\0${HOME}`)?.opened_folder_id).not.toBe(`${HOME}/docs`)
	})

	test('two folders of one local root keep the winner when the first resumes first', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/docs`)
		fake.seed_folder(`${HOME}/pics`)
		fake.seed_folder('/')
		fake.seed_folder('/docs')
		let current: WorkspaceStore | null = null
		const drives = create_explorer_drives({
			is_desktop: true,
			home_path: async () => HOME,
			local_file_manager: () => fake.fm,
			async open_cloud(item) {
				const created = await createWorkspaceStore(
					{ id: item.id, type: 'local', name: item.name },
					fake.fm,
					{ root_folder_id: '/' },
				)
				if (!created) throw new Error('failed to open cloud')
				return created
			},
			cloud_roots: () => [{ id: 'ws-1', name: 'Notes', can_write: true }],
			browser_file_manager: async () => fake.fm,
			adopt: (workspace) => { current = workspace },
		})
		const nav = create_explorer_navigation({
			open_root(drive_id, root_id, still_current) {
				if (drive_id === 'local') return drives.open_local_path(root_id, still_current)
				return drives.open(drive_id, root_id, still_current)
			},
			current_store: () => current,
			async default_folder() {
				return { drive_id: 'local', root_id: HOME, folder_id: HOME }
			},
			async home_path() { return HOME },
			last_location: ref(null),
		})

		try {
			await nav.open_folder({ drive_id: 'cloud', root_id: 'ws-1', folder_id: '/docs' })
			const first = nav.open_folder({
				drive_id: 'local',
				root_id: HOME,
				folder_id: `${HOME}/docs`,
			})
			const second = nav.open_folder({
				drive_id: 'local',
				root_id: HOME,
				folder_id: `${HOME}/pics`,
			})
			await first
			await second
			expect(nav.location).toEqual({
				kind: 'folder',
				ref: { drive_id: 'local', root_id: HOME, folder_id: `${HOME}/pics` },
			})
			expect(current!.is_disposed).toBe(false)
			expect(current!.opened_folder_id).toBe(`${HOME}/pics`)
		} finally {
			drives.dispose_all()
		}
	})

	test('launch opens the default root when the saved drive cannot be opened', async () => {
		const base = setup()
		const saved: FolderRef = { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/docs' }
		base.last.value = { ...saved }
		const nav = create_explorer_navigation({
			async open_root(drive_id, root_id, still_current) {
				if (drive_id === 'cloud') throw new Error('No access to workspace “ws-1”')
				return base.open_root(drive_id, root_id, still_current)
			},
			current_store: () => base.current(),
			async default_folder() {
				return { drive_id: 'local', root_id: HOME, folder_id: HOME }
			},
			async home_path() { return HOME },
			last_location: base.last,
		})

		await nav.open_at_launch()
		expect(nav.location).toEqual({
			kind: 'folder',
			ref: { drive_id: 'local', root_id: HOME, folder_id: HOME },
		})
		expect(base.last.value).toEqual(saved)
		expect(nav.can_go_back).toBe(false)
	})

	test('going to a deleted folder opens the root of its drive', async () => {
		const { nav, fake, current } = setup()
		await nav.open_at_launch()
		await nav.open_folder({ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/docs` })
		await nav.go_back()
		await fake.fm.remove(`${HOME}/docs`)

		await nav.go_forward()
		expect(folder_of(nav)).toBe(HOME)
		expect(current()!.opened_folder_id).toBe(HOME)
		expect(nav.can_go_forward).toBe(false)
		expect(nav.can_go_back).toBe(false)
		expect(current()!.go_back).not.toHaveBeenCalled()
	})

	test('cancel drops a navigation that has not finished', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/docs`)
		const created = await createWorkspaceStore(
			{ id: HOME, type: 'local', name: HOME },
			fake.fm,
			{ root_folder_id: HOME },
		)
		if (!created) throw new Error('failed to open')
		lingering.push(created)
		const open_folder = vi.spyOn(created, 'open_folder')
		let release!: () => void
		const gate = new Promise<void>(resolve => { release = resolve })
		const last = ref<FolderRef | null>(null)
		const nav = create_explorer_navigation({
			async open_root() {
				await gate
				return created
			},
			current_store: () => created,
			async default_folder() {
				return { drive_id: 'local', root_id: HOME, folder_id: HOME }
			},
			async home_path() { return HOME },
			last_location: last,
		})

		const pending = nav.open_folder({
			drive_id: 'local',
			root_id: HOME,
			folder_id: `${HOME}/docs`,
		})
		nav.cancel()
		release()
		await pending
		expect(nav.location).toBeNull()
		expect(open_folder).not.toHaveBeenCalled()
		expect(last.value).toBeNull()
	})
})

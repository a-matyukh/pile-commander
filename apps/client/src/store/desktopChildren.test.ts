import { describe, expect, it, vi } from 'vitest'
import { ref } from 'vue'
import { createFakeFileManager, type FakeFileManager } from '@pile-commander/file-manager'
import type { Desktop } from '@/domain/Desktop'
import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import type { WorkspaceTile } from '@/services/cloud/desktopBoards'
import { createDesktopsStore, default_state } from './desktops'
import {
	createDesktopChildrenStore,
	type CloudDesktopChildrenDeps,
	type DesktopChildrenDeps,
} from './desktopChildren'

function make_desktop(id: string, name = id): Desktop {
	return { id, backend: 'local', name, xattrs: {}, windows: [] }
}

function make_fake_workspace(): WorkspaceStore & { dispose: ReturnType<typeof vi.fn> } {
	return { dispose: vi.fn() } as unknown as WorkspaceStore & {
		dispose: ReturnType<typeof vi.fn>
	}
}

function make_fake_registry() {
	const stores = new Map<string, WorkspaceStore>()
	return {
		stores,
		get_for_desktop: vi.fn((id: string) => stores.get(id) ?? null),
		register_desktop: vi.fn((id: string, ws: WorkspaceStore) => {
			stores.set(id, ws)
		}),
		dispose_for_desktop: vi.fn((id: string) => {
			stores.get(id)?.dispose()
			stores.delete(id)
		}),
	}
}

function make_deps(overrides?: Partial<DesktopChildrenDeps>) {
	return {
		ensure_folder: vi.fn(async (desktop: Desktop) =>
			desktop.path ?? `/app-data/desktops/${desktop.id}`),
		open_store: vi.fn(async (_item: WorkspacesListItem) => make_fake_workspace()),
		is_available: () => true,
		child_item_type: () => 'local' as const,
		...overrides,
	}
}

/** In-memory cloud backend: system workspace fm + tiles + child workspace fms */
function make_cloud_deps(overrides?: Partial<CloudDesktopChildrenDeps>) {
	const system = createFakeFileManager()
	system.seed_folder('/')
	const server_tiles = new Map<string, WorkspaceTile[]>()
	const child_fms = new Map<string, FakeFileManager>()
	let seq = 0

	const deps: CloudDesktopChildrenDeps = {
		is_available: async () => true,
		system_workspace_id: async () => 'sys-ws-id',
		board_files_folder_exists: vi.fn(async (_system_id: string, desktop_id: string) =>
			system.has(`/desktop-${desktop_id}`)),
		list_tiles: vi.fn(async (desktop_id: string) => server_tiles.get(desktop_id) ?? []),
		create_tile: vi.fn(async (desktop_id: string, name: string) => {
			const workspace_id = `ws-${++seq}`
			server_tiles.set(desktop_id, [
				...(server_tiles.get(desktop_id) ?? []),
				{ workspace_id, name, xattrs: {} },
			])
			return workspace_id
		}),
		rename_tile: vi.fn(async (workspace_id: string, name: string) => {
			for (const [desktop_id, tiles] of server_tiles) {
				server_tiles.set(desktop_id, tiles.map(t =>
					t.workspace_id === workspace_id ? { ...t, name } : t,
				))
			}
		}),
		remove_tile: vi.fn(async (workspace_id: string) => {
			for (const [desktop_id, tiles] of server_tiles) {
				server_tiles.set(desktop_id, tiles.filter(t => t.workspace_id !== workspace_id))
			}
		}),
		set_tile_xattr: vi.fn(async () => {}),
		system_fm: () => system.fm,
		workspace_fm: (workspace_id: string) => {
			let fm = child_fms.get(workspace_id)
			if (!fm) {
				fm = createFakeFileManager()
				fm.seed_folder('/')
				child_fms.set(workspace_id, fm)
			}
			return fm.fm
		},
		sync_sidebar: vi.fn(),
		...overrides,
	}
	return { deps, system, server_tiles, child_fms }
}

function make_cloud_desktops_store() {
	return createDesktopsStore(ref(default_state()))
}

describe('desktopChildren store', () => {
	it('opens the desktop folder lazily and registers the store', async () => {
		const deps = make_deps()
		const registry = make_fake_registry()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const desktop = desktops_store.add_desktop('Main')
		const store = await children.get_store(desktop)

		expect(deps.ensure_folder).toHaveBeenCalledWith(desktop)
		expect(deps.open_store).toHaveBeenCalledWith({
			id: `/app-data/desktops/${desktop.id}`,
			type: 'local',
			name: 'Main',
		})
		expect(registry.register_desktop).toHaveBeenCalledWith(desktop.id, store)
	})

	it('opens a desktop with a custom path from the adopted folder', async () => {
		const deps = make_deps()
		const registry = make_fake_registry()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const desktop = desktops_store.add_desktop('Work', 'local', '/users/me/work')
		const store = await children.get_store(desktop)

		expect(deps.ensure_folder).toHaveBeenCalledWith(desktop)
		expect(deps.open_store).toHaveBeenCalledWith({
			id: '/users/me/work',
			type: 'local',
			name: 'Work',
		})
		expect(registry.register_desktop).toHaveBeenCalledWith(desktop.id, store)
	})

	it('returns null and reports when the adopted folder is missing (never recreates it)', async () => {
		const on_error = vi.fn()
		const deps = make_deps({
			ensure_folder: vi.fn(async (desktop: Desktop) => {
				throw new Error(`The desktop folder is missing: ${desktop.path}`)
			}),
			on_error,
		})
		const registry = make_fake_registry()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const desktop = desktops_store.add_desktop('Work', 'local', '/users/me/gone')
		const store = await children.get_store(desktop)

		expect(store).toBeNull()
		expect(deps.open_store).not.toHaveBeenCalled()
		expect(on_error).toHaveBeenCalledWith('The desktop folder is missing: /users/me/gone')
		expect(registry.get_for_desktop(desktop.id)).toBeNull()
	})

	it('returns the cached store on the second call', async () => {
		const deps = make_deps()
		const registry = make_fake_registry()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const desktop = desktops_store.add_desktop()
		const first = await children.get_store(desktop)
		const second = await children.get_store(desktop)

		expect(second).toBe(first)
		expect(deps.open_store).toHaveBeenCalledTimes(1)
	})

	it('dedups concurrent opens', async () => {
		const deps = make_deps()
		const registry = make_fake_registry()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const desktop = desktops_store.add_desktop()
		const [a, b] = await Promise.all([
			children.get_store(desktop),
			children.get_store(desktop),
		])

		expect(a).toBe(b)
		expect(deps.open_store).toHaveBeenCalledTimes(1)
	})

	it('drops the store when the desktop was removed mid-load', async () => {
		// slow ensure_folder: the desktop disappears while the open is in flight
		const desktops_store = createDesktopsStore(ref(default_state()))
		const desktop = desktops_store.add_desktop('Main')
		desktops_store.add_desktop('Other')
		const deps = make_deps({
			ensure_folder: vi.fn(async (d: Desktop) => {
				desktops_store.remove_desktop(d.id)
				return `/app-data/desktops/${d.id}`
			}),
		})
		const registry = make_fake_registry()
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const store = await children.get_store(desktop)

		expect(store).toBeNull()
		expect(registry.get_for_desktop(desktop.id)).toBeNull()
	})

	it('returns null when children are unavailable (web)', async () => {
		const deps = make_deps({ is_available: () => false })
		const children = createDesktopChildrenStore(
			deps,
			make_fake_registry(),
			createDesktopsStore(ref(default_state())),
		)

		expect(await children.get_store(make_desktop('d1'))).toBeNull()
		expect(deps.ensure_folder).not.toHaveBeenCalled()
		expect(deps.open_store).not.toHaveBeenCalled()
	})

	it('disposes the children store when the desktop is removed', async () => {
		const deps = make_deps()
		const registry = make_fake_registry()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, registry, desktops_store)

		const keep = desktops_store.add_desktop('keep')
		const gone = desktops_store.add_desktop('gone')
		const store = await children.get_store(gone)
		expect(registry.get_for_desktop(gone.id)).toBe(store)

		expect(desktops_store.remove_desktop(gone.id)).toBe(true)
		expect(registry.dispose_for_desktop).toHaveBeenCalledWith(gone.id)
		expect(store!.dispose).toHaveBeenCalled()
		expect(registry.get_for_desktop(gone.id)).toBeNull()
		expect(registry.get_for_desktop(keep.id)).toBeNull()
	})

	it('opens a child folder as a window instead of navigating', async () => {
		const deps = make_deps()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, make_fake_registry(), desktops_store)

		const desktop = desktops_store.add_desktop('Main')
		const store = await children.get_store(desktop)
		const folder_id = `/app-data/desktops/${desktop.id}/Docs`

		await store!.open_folder(folder_id)

		expect(desktop.windows).toHaveLength(1)
		expect(desktop.windows[0]!.content).toEqual({
			kind: 'workspace',
			item: { type: 'local', id: folder_id, name: 'Docs' },
		})
	})

	it('focuses the existing window instead of opening a duplicate', async () => {
		const deps = make_deps()
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, make_fake_registry(), desktops_store)

		const desktop = desktops_store.add_desktop('Main')
		const store = await children.get_store(desktop)
		const folder_id = `/app-data/desktops/${desktop.id}/Docs`

		await store!.open_folder_in_new_tab(folder_id)
		desktops_store.hide_window(desktop.windows[0]!.id)
		await store!.open_folder(folder_id)

		expect(desktop.windows).toHaveLength(1)
		// minimized window is restored by the reopen
		expect(desktop.windows[0]!.state).toBe('floating')
	})

	it('web wiring: opens the root store and child windows with type browser', async () => {
		const deps = make_deps({ child_item_type: () => 'browser' as const })
		const desktops_store = createDesktopsStore(ref(default_state()))
		const children = createDesktopChildrenStore(deps, make_fake_registry(), desktops_store)

		const desktop = desktops_store.add_desktop('Main')
		const store = await children.get_store(desktop)

		expect(deps.open_store).toHaveBeenCalledWith({
			id: `/app-data/desktops/${desktop.id}`,
			type: 'browser',
			name: 'Main',
		})

		const folder_id = `/app-data/desktops/${desktop.id}/Docs`
		await store!.open_folder(folder_id)
		expect(desktop.windows[0]!.content).toEqual({
			kind: 'workspace',
			item: { type: 'browser', id: folder_id, name: 'Docs' },
		})
	})
})

describe('desktopChildren store: cloud desktops', () => {
	it('opens the board: lazy-creates the files folder and merges workspace tiles', async () => {
		const cloud = make_cloud_deps()
		cloud.server_tiles.set('ignored', []) // noise
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: { position: '{"x":1,"y":2}' } },
		])

		const store = await children.get_store(desktop)

		expect(store).not.toBeNull()
		// the files folder is created lazily inside the system workspace
		expect(cloud.system.has(`/desktop-${desktop.id}`)).toBe(true)
		expect(store!.id).toBe(`/desktop-${desktop.id}`)
		expect(store!.opened_folder.children).toEqual([
			{
				id: `/desktop-${desktop.id}/ws-1`,
				name: 'Research',
				type: 'folder',
				xattrs: [{ name: 'position', value: '{"x":1,"y":2}' }],
			},
		])
		expect(cloud.deps.list_tiles).toHaveBeenCalledWith(desktop.id)
	})

	it('returns null without a session (e.g. during logout teardown)', async () => {
		const cloud = make_cloud_deps({ is_available: async () => false })
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)

		const desktop = desktops_store.add_desktop('Main', 'cloud')
		expect(await children.get_store(desktop)).toBeNull()
		expect(cloud.deps.list_tiles).not.toHaveBeenCalled()
	})

	it('reports a connection error when the cloud board cannot be reached, then opens on retry', async () => {
		let fail = true
		const cloud = make_cloud_deps()
		cloud.deps.list_tiles = vi.fn(async (desktop_id: string) => {
			if (fail) throw new TypeError('Failed to fetch')
			return cloud.server_tiles.get(desktop_id) ?? []
		})
		const errors: string[] = []
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps({ on_error: (message) => { errors.push(message) } }),
			make_fake_registry(),
			desktops_store,
			cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')

		expect(await children.get_store(desktop)).toBeNull()
		expect(errors).toEqual(['This cloud desktop needs a connection.'])

		fail = false
		expect(await children.get_store(desktop)).not.toBeNull()
	})

	it('"New folder" creates a workspace tile and syncs the sidebar', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		const store = await children.get_store(desktop)

		const tile_id = await store!.create_folder(store!.id, { x: 10, y: 20 })

		expect(cloud.deps.create_tile).toHaveBeenCalledWith(desktop.id, 'New folder 1')
		expect(tile_id).toBe(`/desktop-${desktop.id}/ws-1`)
		expect(store!.opened_folder.children.map(c => c.id)).toContain(tile_id)
		// tile presentation xattrs land on the workspace row, not on an entry
		expect(cloud.deps.set_tile_xattr).toHaveBeenCalledWith(
			'ws-1', 'position', JSON.stringify({ x: 10, y: 20 }),
		)
		expect(cloud.deps.sync_sidebar).toHaveBeenCalled()
		// the seeded empty preview cache is dropped: the first preview fetch
		// reads the real workspace
		expect(store!.folders[tile_id]).toBeUndefined()
		// no entry folder leaked into the system workspace
		expect(cloud.system.has(`/desktop-${desktop.id}/New folder 1`)).toBe(false)
	})

	it('file creation goes to the system workspace, not to a workspace', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		const store = await children.get_store(desktop)

		await store!.create_text_file(store!.id, { x: 1, y: 1 })

		expect(cloud.deps.create_tile).not.toHaveBeenCalled()
		const files = cloud.system.calls
			.filter(c => c.method === 'create_text_file')
			.map(c => c.args)
		expect(files).toEqual([[`/desktop-${desktop.id}`, 'New text file 1.txt']])
	})

	it('opens a workspace tile as a cloud workspace window (focus on reopen)', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		const store = await children.get_store(desktop)
		const tile_id = `/desktop-${desktop.id}/ws-1`

		await store!.open_folder(tile_id)
		expect(desktop.windows).toHaveLength(1)
		expect(desktop.windows[0]!.content).toEqual({
			kind: 'workspace',
			item: { type: 'cloud', id: 'ws-1', name: 'Research' },
		})

		desktops_store.hide_window(desktop.windows[0]!.id)
		await store!.open_folder_in_new_tab(tile_id)
		expect(desktop.windows).toHaveLength(1)
		expect(desktop.windows[0]!.state).toBe('floating')
	})

	it('removes a tile by deleting the workspace row', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		const store = await children.get_store(desktop)
		const tile_id = `/desktop-${desktop.id}/ws-1`

		await store!.remove(tile_id)

		expect(cloud.deps.remove_tile).toHaveBeenCalledWith('ws-1')
		expect(store!.opened_folder.children.some(c => c.id === tile_id)).toBe(false)
		expect(cloud.deps.sync_sidebar).toHaveBeenCalled()
	})

	it('workspace_tile_at resolves tile roots only (drives the tile menu)', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		await children.get_store(desktop)
		const root = `/desktop-${desktop.id}`

		// tile root → the tile
		expect(children.workspace_tile_at(`${root}/ws-1`)).toEqual({
			workspace_id: 'ws-1', name: 'Research', xattrs: {},
		})
		// a path INSIDE the tile workspace is a regular entry, not a tile
		expect(children.workspace_tile_at(`${root}/ws-1/notes.txt`)).toBeNull()
		// a loose board file is a system-workspace entry
		expect(children.workspace_tile_at(`${root}/readme.txt`)).toBeNull()
		// a desktop whose board was never opened has no tiles
		expect(children.workspace_tile_at('/desktop-unknown/ws-1')).toBeNull()
	})

	it('refresh_cloud_boards picks up workspace changes from the sidebar', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		const store = await children.get_store(desktop)
		expect(store!.opened_folder.children).toHaveLength(0)

		// a workspace pinned from another device / session
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-9', name: 'External', xattrs: {} },
		])
		await children.refresh_cloud_boards()

		expect(store!.opened_folder.children.map(c => c.name)).toEqual(['External'])

		// and removed from the sidebar → the tile disappears
		cloud.server_tiles.set(desktop.id, [])
		await children.refresh_cloud_boards()
		expect(store!.opened_folder.children).toHaveLength(0)
	})

	it('moves a board file into a workspace tile via client-side transfer', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		const store = await children.get_store(desktop)
		const root = `/desktop-${desktop.id}`
		cloud.system.seed_file(`${root}/notes.txt`, 'board note')
		cloud.system.set_xattr(`${root}/notes.txt`, 'position', JSON.stringify({ x: 5, y: 6 }))
		await store!.reload_folder_cache(root)

		const new_id = await store!.move(`${root}/notes.txt`, `${root}/ws-1`, 0)

		expect(new_id).toBe(`${root}/ws-1/notes.txt`)
		// content and xattrs landed in the child workspace
		const child = cloud.child_fms.get('ws-1')!
		expect(await child.fm.read_text_file('/notes.txt')).toBe('board note')
		expect(child.get_xattr('/notes.txt', 'position')).toBe(JSON.stringify({ x: 5, y: 6 }))
		// source removed from the system workspace + board cache
		expect(cloud.system.has(`${root}/notes.txt`)).toBe(false)
		expect(store!.opened_folder.children.some(c => c.id === `${root}/notes.txt`)).toBe(false)
		// the tile folder is now cached with the moved entry
		expect(store!.folders[`${root}/ws-1`]?.children.some(c => c.id === `${root}/ws-1/notes.txt`)).toBe(true)
		// nothing was routed through the forbidden cross-workspace fm.move:
		// the transfer went read→write instead
		expect(cloud.system.calls.some(c => c.method === 'move')).toBe(false)
	})

	it('moves a board folder into a workspace tile recursively', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		const store = await children.get_store(desktop)
		const root = `/desktop-${desktop.id}`
		cloud.system.seed_folder(`${root}/docs`)
		cloud.system.seed_file(`${root}/docs/a.txt`, 'a')
		await store!.reload_folder_cache(root)

		const new_id = await store!.move(`${root}/docs`, `${root}/ws-1`, 0)

		expect(new_id).toBe(`${root}/ws-1/docs`)
		const child = cloud.child_fms.get('ws-1')!
		expect(await child.fm.read_text_file('/docs/a.txt')).toBe('a')
		expect(cloud.system.has(`${root}/docs`)).toBe(false)
	})

	it('still refuses moving a tile into another tile', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
			{ workspace_id: 'ws-2', name: 'Archive', xattrs: {} },
		])
		const store = await children.get_store(desktop)
		const root = `/desktop-${desktop.id}`

		const result = await store!.move(`${root}/ws-1`, `${root}/ws-2`, 0)

		expect(result).toBeUndefined()
		expect(store!.last_error).toBeTruthy()
	})

	it('refuses to uncombine a workspace tile', async () => {
		const cloud = make_cloud_deps()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(
			make_deps(), make_fake_registry(), desktops_store, cloud.deps,
		)
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		const store = await children.get_store(desktop)

		await store!.uncombine_folder(`/desktop-${desktop.id}/ws-1`)

		expect(store!.last_error).toMatch(/cannot be uncombined/)
		expect(cloud.deps.remove_tile).not.toHaveBeenCalled()
	})

	it('disposes the cloud children store when the desktop is removed', async () => {
		const cloud = make_cloud_deps()
		const registry = make_fake_registry()
		const desktops_store = make_cloud_desktops_store()
		const children = createDesktopChildrenStore(make_deps(), registry, desktops_store, cloud.deps)
		desktops_store.add_desktop('keep')
		const desktop = desktops_store.add_desktop('Main', 'cloud')
		cloud.server_tiles.set(desktop.id, [
			{ workspace_id: 'ws-1', name: 'Research', xattrs: {} },
		])
		const store = await children.get_store(desktop)
		expect(registry.get_for_desktop(desktop.id)).toBe(store)

		expect(desktops_store.remove_desktop(desktop.id)).toBe(true)

		expect(registry.dispose_for_desktop).toHaveBeenCalledWith(desktop.id)
		expect(registry.get_for_desktop(desktop.id)).toBeNull()
		// refresh after removal is a no-op (tile caches were dropped)
		await children.refresh_cloud_boards()
		expect(cloud.deps.list_tiles).toHaveBeenCalledTimes(1)
	})
})

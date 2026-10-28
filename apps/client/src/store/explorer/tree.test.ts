import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { Drive, DriveRoot, FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import {
	create_explorer_tree,
	folder_has_chevron,
	folder_probe_from_children,
	is_legacy_browser_folder,
	legacy_browser_folder_name,
	tree_root_folder_id,
	visible_folder_children,
	type ExplorerTreeDeps,
	type ExplorerTreeRoot,
} from './tree'
import type { ExplorerLocation } from './navigation'
import { createWorkspaceStore } from '@/store/createWorkspaceStore'
import { explorer_language } from './language'

vi.spyOn(console, 'error').mockImplementation(() => {})

const ROOT: DriveRoot = { id: '/browser-desktops', name: 'Browser storage', can_write: true }

function fake_store(id = ROOT.id): WorkspaceStore {
	return {
		id,
		opened_folder_id: id,
		is_disposed: false,
		can_write: true,
		tree: [],
		is_folder_expanded: vi.fn(() => false),
		toggle_folder_expanded: vi.fn(),
		expand_folder_in_sidebar: vi.fn(async () => {}),
		is_folder_loading: vi.fn(() => false),
		tree_loaded_folder_ids: new Set<string>(),
		show_folder_children: vi.fn(async () => {}),
		file_manager: { FolderChildren: vi.fn(async () => []) },
		create_folder: vi.fn(async () => ''),
		rename: vi.fn(async () => {}),
		remove: vi.fn(async () => {}),
		uncombine_folder: vi.fn(async () => {}),
	} as unknown as WorkspaceStore
}

function fixture(over: {
	roots?: DriveRoot[]
	workspace?: WorkspaceStore
	location?: ExplorerLocation | null
	legacy?: WorkspacesListItem[]
} = {}) {
	const workspace = over.workspace ?? fake_store()
	const drive: Drive = {
		id: 'browser',
		kind: 'browser',
		name: 'Browser storage',
		icon: 'tabler:database',
		trash: null,
		roots: vi.fn(async () => over.roots ?? [ROOT]),
		store_for: vi.fn(async () => workspace),
	}
	let location = over.location ?? null
	const open_folder = vi.fn(async (_ref: FolderRef) => {})
	const set_expanded = vi.fn()
	const on_error = vi.fn()
	const deps: ExplorerTreeDeps = {
		current_location: () => location,
		open_folder,
		set_expanded,
		browser_workspaces: () => over.legacy ?? [],
		on_error,
	}
	const tree = create_explorer_tree(deps)
	return {
		drive,
		workspace,
		tree,
		open_folder,
		set_expanded,
		on_error,
		set_location(value: ExplorerLocation | null) { location = value },
	}
}

function node(id: string, name = id): WorkspaceTreeNode {
	return { id, name, type: 'folder', children_loaded: false }
}

describe('explorer tree', () => {
	test('the current root and its ancestors are expanded through its own store', async () => {
		const ref: FolderRef = {
			drive_id: 'browser',
			root_id: ROOT.id,
			folder_id: `${ROOT.id}/old/documents`,
		}
		const { tree, drive, workspace, set_expanded } = fixture({
			location: { kind: 'folder', ref },
		})

		await tree.show_drive(drive, ref)

		expect(set_expanded).toHaveBeenLastCalledWith(new Set([ROOT.id]))
		expect(drive.store_for).toHaveBeenCalledWith(ROOT.id)
		expect(workspace.expand_folder_in_sidebar).toHaveBeenCalledWith(ref.folder_id)
		expect(tree_root_folder_id(tree.roots[0]!)).toBe(ROOT.id)
	})

	test('the primary root stays open; another root is marked before opening and released on collapse', async () => {
		const outside = { id: '/Volumes/Disk', name: 'Disk', can_write: true }
		const { drive } = fixture({ roots: [ROOT, outside] })
		drive.kind = 'local'
		const calls: string[] = []
		drive.store_for = vi.fn(async () => {
			calls.push('store')
			return fake_store()
		})
		const tree = create_explorer_tree({
			current_location: () => null,
			open_folder: async () => {},
			set_expanded: () => calls.push('expanded'),
			browser_workspaces: () => [],
			on_error: () => {},
		})
		await tree.show_drive(drive, null)
		const primary = tree.roots[0]!
		const root = tree.roots[1]!
		expect(tree.is_root_expanded(primary)).toBe(true)
		calls.length = 0

		await tree.toggle_root(root)
		expect(calls).toEqual(['expanded', 'store'])
		await tree.toggle_root(root)
		expect(tree.is_root_expanded(root)).toBe(false)
		expect(tree.is_root_expanded(primary)).toBe(true)
	})

	test('an empty list of roots counts as listed, unlike one still loading', async () => {
		const { tree, drive } = fixture({ roots: [] })
		expect(tree.listed_drive_id).toBeNull()
		await tree.show_drive(drive, null)
		expect(tree.roots).toEqual([])
		expect(tree.listed_drive_id).toBe(drive.id)
		tree.show_page()
		expect(tree.listed_drive_id).toBeNull()
	})

	test('a closed folder loads through expand_folder_in_sidebar, an open one toggles shut', async () => {
		const { tree, drive, workspace } = fixture()
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!
		const child = node(`${ROOT.id}/child`)

		await tree.toggle_folder(item, child)
		expect(workspace.expand_folder_in_sidebar).toHaveBeenCalledWith(child.id)

		vi.mocked(workspace.is_folder_expanded).mockReturnValue(true)
		await tree.toggle_folder(item, child)
		expect(workspace.toggle_folder_expanded).toHaveBeenCalledWith(child.id)
	})

	test('back in focus, shown folders without a watch are read again', async () => {
		const { tree, drive, workspace } = fixture()
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!
		const unread = node(`${ROOT.id}/unread`)
		const collapsed = { ...node(`${ROOT.id}/collapsed`), children: [], children_loaded: true }
		const open = { ...node(`${ROOT.id}/open`), children: [], children_loaded: true }
		vi.mocked(workspace.is_folder_expanded).mockImplementation(id => id === open.id)
		const list = vi.mocked(workspace.file_manager.FolderChildren)
		list.mockResolvedValue([])

		tree.probe_folders(item, [unread, collapsed, open])
		await vi.waitFor(() => expect(tree.is_probing(item, unread.id)).toBe(false))
		expect(tree.has_chevron(item, unread, false)).toBe(false)
		// Fresh until the window has been away: loaded folders are not read
		expect(workspace.show_folder_children).not.toHaveBeenCalled()

		// Same round: nothing is read twice
		tree.probe_folders(item, [unread, collapsed, open])
		expect(list).toHaveBeenCalledTimes(1)

		// Finder added a subfolder; the window comes back
		list.mockResolvedValue([{ id: `${unread.id}/new`, name: 'new', type: 'folder' }])
		tree.refresh_shown()
		tree.probe_folders(item, [unread, collapsed, open])
		await vi.waitFor(() => expect(tree.has_chevron(item, unread, false)).toBe(true))
		expect(workspace.show_folder_children).toHaveBeenCalledWith(collapsed.id, undefined, { silent: true, refresh: true })
		expect(workspace.show_folder_children).not.toHaveBeenCalledWith(open.id, expect.anything(), expect.anything())
	})

	test('a focus during a slow read reads the folder once more after it', async () => {
		const { tree, drive, workspace } = fixture()
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!
		const slow = node(`${ROOT.id}/slow`)
		const list = vi.mocked(workspace.file_manager.FolderChildren)
		let finish!: () => void
		list.mockImplementationOnce(() => new Promise(resolve => { finish = () => resolve([]) }))

		tree.probe_folders(item, [slow])
		await vi.waitFor(() => expect(list).toHaveBeenCalledTimes(1))
		// Finder adds a subfolder and the window comes back while the read runs
		list.mockResolvedValue([{ id: `${slow.id}/new`, name: 'new', type: 'folder' }])
		tree.refresh_shown()
		tree.probe_folders(item, [slow])
		finish()

		await vi.waitFor(() => expect(tree.has_chevron(item, slow, false)).toBe(true))
		expect(list).toHaveBeenCalledTimes(2)
	})

	test('a renamed folder takes its bookmarks along', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/home')
		fake.seed_folder('/home/Old')
		fake.seed_folder('/home/Old/sub')
		const workspace = await createWorkspaceStore({ id: '/home', type: 'local', name: 'home' }, fake.fm, { root_folder_id: '/home' })
		if (!workspace) throw new Error('no store')
		const retarget_bookmarks = vi.fn()
		const tree = create_explorer_tree({
			current_location: () => null,
			open_folder: async () => {},
			set_expanded: () => {},
			browser_workspaces: () => [],
			on_error: () => {},
			retarget_bookmarks,
		})
		const drive: Drive = {
			id: 'local', kind: 'local', name: 'Mac', icon: '', trash: 'system',
			roots: async () => [{ id: '/home', name: 'Home', can_write: true }],
			store_for: async () => workspace,
		}
		await tree.show_drive(drive, null)
		const old = workspace.tree.find(node => node.id === '/home/Old')!
		await tree.rename_folder(tree.roots[0]!, old, 'New')
		expect(retarget_bookmarks).toHaveBeenCalledWith(
			{ drive_id: 'local', root_id: '/home', folder_id: '/home/Old' },
			{ drive_id: 'local', root_id: '/home', folder_id: '/home/New' },
		)
		workspace.dispose()
	})

	test('duplicate and copy keep the original; the copy gets a free name', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/home')
		fake.seed_folder('/home/A')
		fake.seed_file('/home/A/note.md')
		fake.seed_folder('/home/B')
		const workspace = await createWorkspaceStore({ id: '/home', type: 'local', name: 'home' }, fake.fm, { root_folder_id: '/home' })
		if (!workspace) throw new Error('no store')
		const on_error = vi.fn()
		const tree = create_explorer_tree({
			current_location: () => null,
			open_folder: async () => {},
			set_expanded: () => {},
			browser_workspaces: () => [],
			on_error,
		})
		const drive: Drive = {
			id: 'local', kind: 'local', name: 'Mac', icon: '', trash: 'system',
			roots: async () => [{ id: '/home', name: 'Home', can_write: true }],
			store_for: async () => workspace,
		}
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!
		const a = workspace.tree.find(node => node.id === '/home/A')!

		await tree.duplicate_folder(item, a)
		await tree.copy_folder(item, a, item, '/home/B')

		const names = (await fake.fm.FolderChildren('/home')).map(child => child.name).sort()
		expect(names.filter(name => name.startsWith('A'))).toHaveLength(2)
		expect(names).toContain('A')
		expect((await fake.fm.FolderChildren('/home/B')).map(child => child.name)).toEqual(['A'])
		expect((await fake.fm.FolderChildren('/home/B/A')).map(child => child.name)).toEqual(['note.md'])
		expect(on_error).not.toHaveBeenCalled()
		workspace.dispose()
	})

	test('a folder read before is read again when expanded: while collapsed it had no watch', async () => {
		const { tree, drive, workspace } = fixture()
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!
		const fresh = node(`${ROOT.id}/fresh`)
		const seen = { ...node(`${ROOT.id}/seen`), children: [], children_loaded: true }

		await tree.toggle_folder(item, fresh)
		await tree.toggle_folder(item, seen)

		expect(workspace.show_folder_children).toHaveBeenCalledWith(fresh.id, undefined, { silent: true, refresh: false })
		expect(workspace.show_folder_children).toHaveBeenCalledWith(seen.id, undefined, { silent: true, refresh: true })
	})

	test('only visible folders are projected, with dot names controlled by the existing setting', () => {
		const folders: WorkspaceTreeNode[] = [
			node('/visible', 'visible'),
			node('/.hidden', '.hidden'),
			{ id: '/file.txt', name: 'file.txt', type: 'file' },
		]
		expect(visible_folder_children(folders, false).map(item => item.id)).toEqual(['/visible'])
		expect(visible_folder_children(folders, true).map(item => item.id)).toEqual(['/visible', '/.hidden'])
	})

	test('legacy browser folders use old workspace names and cannot be renamed', async () => {
		const child = node(`${ROOT.id}/old-id`, 'old-id')
		const legacy: WorkspacesListItem[] = [{ id: child.id, type: 'browser', name: 'Research' }]
		const { tree, drive, workspace } = fixture({ legacy })
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!

		expect(is_legacy_browser_folder(item, child)).toBe(true)
		expect(is_legacy_browser_folder(item, node(`${child.id}/nested`))).toBe(false)
		expect(legacy_browser_folder_name(child.id, child.name, legacy)).toBe('Research')
		expect(tree.node_name(item, child)).toBe('Research')

		await tree.rename_folder(item, child, 'New name')
		expect(workspace.rename).not.toHaveBeenCalled()
	})

	test('creating in an unloaded folder expands and loads it first', async () => {
		const { tree, drive, workspace } = fixture()
		await tree.show_drive(drive, null)
		const child = node(`${ROOT.id}/child`)

		await tree.create_folder(tree.roots[0]!, child)

		expect(workspace.expand_folder_in_sidebar).toHaveBeenCalledWith(child.id)
		expect(workspace.create_folder).toHaveBeenCalledWith(child.id)
	})

	test('renaming the current branch refreshes its navigation ref', async () => {
		const ref: FolderRef = { drive_id: 'browser', root_id: ROOT.id, folder_id: `${ROOT.id}/workspace/old` }
		const workspace = fake_store()
		vi.mocked(workspace.rename).mockImplementation(async () => {
			workspace.opened_folder_id = `${ROOT.id}/workspace/new`
		})
		const { tree, drive, open_folder } = fixture({
			workspace,
			location: { kind: 'folder', ref },
		})
		await tree.show_drive(drive, ref)

		await tree.rename_folder(tree.roots[0]!, node(ref.folder_id), 'new')

		expect(open_folder).toHaveBeenCalledWith({ ...ref, folder_id: `${ROOT.id}/workspace/new` })
	})

	test('removing the current branch navigates to the folder chosen by the store', async () => {
		const ref: FolderRef = { drive_id: 'browser', root_id: ROOT.id, folder_id: `${ROOT.id}/old` }
		const workspace = fake_store()
		vi.mocked(workspace.remove).mockImplementation(async () => {
			workspace.opened_folder_id = ROOT.id
		})
		const { tree, drive, open_folder } = fixture({
			workspace,
			location: { kind: 'folder', ref },
		})
		await tree.show_drive(drive, ref)

		await tree.remove_folder(tree.roots[0]!, node(ref.folder_id))

		expect(open_folder).toHaveBeenCalledWith({ ...ref, folder_id: ROOT.id })
	})

	test('removing the current folder from its header menu opens its parent', async () => {
		const ref: FolderRef = { drive_id: 'browser', root_id: ROOT.id, folder_id: `${ROOT.id}/workspace/old` }
		const workspace = fake_store()
		vi.mocked(workspace.remove).mockImplementation(async () => {
			workspace.opened_folder_id = ROOT.id
		})
		const { tree, drive, open_folder } = fixture({
			workspace,
			location: { kind: 'folder', ref },
		})
		await tree.show_drive(drive, ref)

		await tree.remove_folder(tree.roots[0]!, node(ref.folder_id), { open_parent: true })

		expect(open_folder).toHaveBeenCalledTimes(1)
		expect(open_folder).toHaveBeenCalledWith({ ...ref, folder_id: `${ROOT.id}/workspace` })
	})

	test('a failed remove from the header menu stays in the folder', async () => {
		const ref: FolderRef = { drive_id: 'browser', root_id: ROOT.id, folder_id: `${ROOT.id}/workspace/old` }
		const workspace = fake_store()
		workspace.opened_folder_id = ref.folder_id
		const { tree, drive, open_folder } = fixture({
			workspace,
			location: { kind: 'folder', ref },
		})
		await tree.show_drive(drive, ref)

		await tree.remove_folder(tree.roots[0]!, node(ref.folder_id), { open_parent: true })

		expect(workspace.remove).toHaveBeenCalledWith(ref.folder_id)
		expect(open_folder).not.toHaveBeenCalled()
	})

	test('ungrouping a folder calls the store\'s uncombine', async () => {
		const { tree, drive, workspace, open_folder } = fixture()
		await tree.show_drive(drive, null)

		await tree.ungroup_folder(tree.roots[0]!, node(`${ROOT.id}/workspace/A`))

		expect(workspace.uncombine_folder).toHaveBeenCalledWith(`${ROOT.id}/workspace/A`)
		expect(open_folder).not.toHaveBeenCalled()
	})

	test('ungrouping the current folder opens its parent', async () => {
		const ref: FolderRef = { drive_id: 'browser', root_id: ROOT.id, folder_id: `${ROOT.id}/workspace/A` }
		const workspace = fake_store()
		workspace.opened_folder_id = ref.folder_id
		vi.mocked(workspace.uncombine_folder).mockImplementation(async () => {
			workspace.opened_folder_id = ROOT.id
		})
		const { tree, drive, open_folder } = fixture({
			workspace,
			location: { kind: 'folder', ref },
		})
		await tree.show_drive(drive, ref)

		await tree.ungroup_folder(tree.roots[0]!, node(ref.folder_id))

		expect(open_folder).toHaveBeenCalledTimes(1)
		expect(open_folder).toHaveBeenCalledWith({ ...ref, folder_id: `${ROOT.id}/workspace` })
	})

	test('a failed ungroup stays in the folder', async () => {
		const ref: FolderRef = { drive_id: 'browser', root_id: ROOT.id, folder_id: `${ROOT.id}/workspace/A` }
		const workspace = fake_store()
		workspace.opened_folder_id = ref.folder_id
		const { tree, drive, open_folder } = fixture({
			workspace,
			location: { kind: 'folder', ref },
		})
		await tree.show_drive(drive, ref)

		await tree.ungroup_folder(tree.roots[0]!, node(ref.folder_id))

		expect(workspace.uncombine_folder).toHaveBeenCalledWith(ref.folder_id)
		expect(open_folder).not.toHaveBeenCalled()
	})

	test('a chevron only for folders with visible subfolders; none while unread unless the read failed', () => {
		const loaded = (id: string, children: WorkspaceTreeNode[]): WorkspaceTreeNode =>
			({ id, name: id.slice(1), type: 'folder', children_loaded: true, children })
		const empty = loaded('/empty', [{ id: '/empty/a.txt', name: 'a.txt', type: 'file' }])
		const nested = loaded('/nested', [node('/nested/sub', 'sub')])
		const hidden_only = loaded('/hidden', [node('/hidden/.git', '.git')])

		expect(folder_has_chevron(empty, false, undefined)).toBe(false)
		expect(folder_has_chevron(nested, false, undefined)).toBe(true)
		expect(folder_has_chevron(hidden_only, false, undefined)).toBe(false)
		expect(folder_has_chevron(hidden_only, true, undefined)).toBe(true)
		expect(folder_has_chevron(node('/unread'), false, undefined)).toBe(false)
		expect(folder_has_chevron(node('/unread'), false, 'unknown')).toBe(true)

		const probed = (children: { type: string; name: string }[]) => folder_probe_from_children(children)
		const files_only = probed([{ type: 'file', name: 'a.txt' }])
		const with_sub = probed([{ type: 'folder', name: 'sub' }])
		const dot_only = probed([{ type: 'folder', name: '.git' }, { type: 'file', name: 'b' }])
		expect(folder_has_chevron(node('/a'), false, files_only)).toBe(false)
		expect(folder_has_chevron(node('/a'), false, with_sub)).toBe(true)
		expect(folder_has_chevron(node('/a'), false, dot_only)).toBe(false)
		expect(folder_has_chevron(node('/a'), true, dot_only)).toBe(true)
	})

	test('shown folders are listed one level ahead without xattrs or the store, a few at a time', async () => {
		const ids = ['empty', 'nested', 'hidden', 'd', 'e', 'f'].map(name => `${ROOT.id}/${name}`)
		const listing: Record<string, { id: string; type: 'folder' | 'file'; name: string }[]> = {
			[ids[0]!]: [{ id: `${ids[0]}/a.txt`, type: 'file', name: 'a.txt' }],
			[ids[1]!]: [{ id: `${ids[1]}/sub`, type: 'folder', name: 'sub' }],
			[ids[2]!]: [{ id: `${ids[2]}/.git`, type: 'folder', name: '.git' }],
		}
		const workspace = fake_store()
		workspace.tree = ids.map(id => node(id, id.split('/').pop()))
		let running = 0
		let max_running = 0
		const pending: Array<() => void> = []
		const folder_children = vi.mocked(workspace.file_manager.FolderChildren)
		folder_children.mockImplementation(async (id: string) => {
			running += 1
			max_running = Math.max(max_running, running)
			await new Promise<void>(resolve => pending.push(resolve))
			running -= 1
			return listing[id] ?? []
		})
		const { drive } = fixture({ workspace })
		const tree = create_explorer_tree({
			current_location: () => null,
			open_folder: async () => {},
			set_expanded: () => {},
			browser_workspaces: () => [],
			on_error: () => {},
		}, { probe_concurrency: 2 })
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!

		tree.probe_folders(item, workspace.tree)
		tree.probe_folders(item, workspace.tree)
		expect(tree.is_probing(item, ids[0]!)).toBe(true)
		expect(tree.has_chevron(item, workspace.tree[1]!, false)).toBe(false)
		while (pending.length || running) {
			pending.shift()?.()
			await new Promise(resolve => setTimeout(resolve, 0))
		}

		expect(max_running).toBe(2)
		expect(folder_children).toHaveBeenCalledTimes(ids.length)
		expect(workspace.show_folder_children).not.toHaveBeenCalled()
		expect(tree.is_probing(item, ids[0]!)).toBe(false)
		expect(tree.has_chevron(item, workspace.tree[0]!, false)).toBe(false)
		expect(tree.has_chevron(item, workspace.tree[1]!, false)).toBe(true)
		expect(tree.has_chevron(item, workspace.tree[2]!, false)).toBe(false)
		expect(tree.has_chevron(item, workspace.tree[2]!, true)).toBe(true)

		tree.probe_folders(item, workspace.tree)
		expect(folder_children).toHaveBeenCalledTimes(ids.length)
	})

	test('the default limit is 4 reads at once', async () => {
		const workspace = fake_store()
		workspace.tree = Array.from({ length: 9 }, (_, i) => node(`${ROOT.id}/f${i}`, `f${i}`))
		let running = 0
		let max_running = 0
		const pending: Array<() => void> = []
		vi.mocked(workspace.file_manager.FolderChildren).mockImplementation(async () => {
			running += 1
			max_running = Math.max(max_running, running)
			await new Promise<void>(resolve => pending.push(resolve))
			running -= 1
			return []
		})
		const { tree, drive } = fixture({ workspace })
		await tree.show_drive(drive, null)
		tree.probe_folders(tree.roots[0]!, workspace.tree)
		while (pending.length || running) {
			pending.shift()?.()
			await new Promise(resolve => setTimeout(resolve, 0))
		}
		expect(max_running).toBe(4)
		expect(workspace.file_manager.FolderChildren).toHaveBeenCalledTimes(9)
	})

	describe('folders macOS guards with a privacy check', () => {
		const HOME = '/Users/me'
		const VOLUME = '/Volumes/Disk'

		async function local_tree(roots: DriveRoot[]) {
			const workspaces = new Map(roots.map(root => [root.id, fake_store(root.id)]))
			const { drive } = fixture({ roots })
			drive.id = 'local'
			drive.kind = 'local'
			drive.store_for = vi.fn(async (root_id: string) => workspaces.get(root_id)!)
			const tree = create_explorer_tree({
				current_location: () => null,
				open_folder: async () => {},
				set_expanded: () => {},
				browser_workspaces: () => [],
				on_error: () => {},
			})
			await tree.show_drive(drive, null)
			for (const item of tree.roots) {
				if (!item.workspace) await tree.toggle_root(item)
			}
			return { tree, workspaces }
		}

		test('guarded folders of ~ and the children of ~/Library are not read ahead and keep the chevron; others are', async () => {
			const { tree, workspaces } = await local_tree([{ id: HOME, name: 'Home', can_write: true }])
			const item = tree.roots[0]!
			const fm = workspaces.get(HOME)!.file_manager
			const library = node(`${HOME}/Library`, 'Library')
			const documents = node(`${HOME}/Documents`, 'Documents')
			const mail = node(`${HOME}/Library/Mail`, 'Mail')
			const safari = node(`${HOME}/Library/Safari`, 'Safari')
			const project = node(`${HOME}/Projects/app`, 'app')
			const reunion = node(`${HOME}/Встреча выпускников`, 'Встреча выпускников')

			tree.probe_folders(item, [library, documents, reunion])
			tree.probe_folders(item, [mail, safari])
			tree.probe_folders(item, [project])
			await vi.waitFor(() => expect(tree.is_probing(item, project.id)).toBe(false))
			await vi.waitFor(() => expect(tree.is_probing(item, reunion.id)).toBe(false))

			const read = vi.mocked(fm.FolderChildren).mock.calls.map(call => call[0])
			expect(read.sort()).toEqual([reunion.id, project.id].sort())
			// An ordinary folder of ~ with no subfolders gets no chevron
			expect(tree.has_chevron(item, reunion, false)).toBe(false)
			for (const skipped of [library, documents, mail, safari]) {
				expect(tree.is_probing(item, skipped.id)).toBe(false)
				expect(tree.has_chevron(item, skipped, false)).toBe(true)
			}
		})


		test('a volume outside ~ is probed like any folder, Library included', async () => {
			const { tree, workspaces } = await local_tree([
				{ id: HOME, name: 'Home', can_write: true },
				{ id: VOLUME, name: 'Disk', can_write: true },
			])
			const volume = tree.roots.find(item => item.root.id === VOLUME)!
			const fm = workspaces.get(VOLUME)!.file_manager
			const nested = node(`${VOLUME}/Library/Fonts`, 'Fonts')

			tree.probe_folders(volume, [nested])
			await vi.waitFor(() => expect(tree.is_probing(volume, nested.id)).toBe(false))

			expect(fm.FolderChildren).toHaveBeenCalledWith(nested.id)
			expect(tree.has_chevron(volume, nested, false)).toBe(false)
		})
	})

	test('a failed look-ahead read keeps the chevron so the folder can still be opened', async () => {
		const workspace = fake_store()
		const child = node(`${ROOT.id}/locked`, 'locked')
		workspace.tree = [child]
		vi.mocked(workspace.file_manager.FolderChildren).mockRejectedValue(new Error('Operation not permitted (os error 1)'))
		const { tree, drive } = fixture({ workspace })
		await tree.show_drive(drive, null)
		const item = tree.roots[0]!

		tree.probe_folders(item, workspace.tree)
		await vi.waitFor(() => expect(tree.is_probing(item, child.id)).toBe(false))

		expect(tree.has_chevron(item, child, false)).toBe(true)
	})

	describe('a protected folder (macOS EPERM)', () => {
		const LIB = '/Users/me/Library'
		const live: WorkspaceStore[] = []
		afterEach(() => {
			for (const workspace of live) workspace.dispose()
			live.length = 0
			explorer_language.value = 'system'
		})

		async function real_store() {
			const fake = createFakeFileManager()
			fake.seed_folder(LIB)
			fake.seed_folder(`${LIB}/Mail`)
			fake.seed_folder(`${LIB}/Mail/V10`)
			const read = fake.fm.folder_with_children_xattrs.bind(fake.fm)
			fake.fm.folder_with_children_xattrs = async (id: string) => {
				if (id === `${LIB}/Mail`) throw new Error('Operation not permitted (os error 1)')
				return read(id)
			}
			const list = fake.fm.FolderChildren.bind(fake.fm)
			fake.fm.FolderChildren = vi.fn(async (id: string) => {
				if (id === `${LIB}/Mail`) throw new Error('Operation not permitted (os error 1)')
				return list(id)
			})
			const workspace = await createWorkspaceStore({ id: LIB, type: 'local', name: 'Library' }, fake.fm)
			if (!workspace) throw new Error('no store')
			live.push(workspace)
			const { tree, drive, on_error } = fixture({ workspace, roots: [{ id: LIB, name: 'Library', can_write: true }] })
			await tree.show_drive(drive, null)
			const mail = () => workspace.tree.find(item => item.id === `${LIB}/Mail`)!
			return { workspace, tree, item: tree.roots[0]!, on_error, mail, fm: fake.fm }
		}

		test('the look-ahead read stays silent and keeps the chevron', async () => {
			const { workspace, tree, item, on_error, mail, fm } = await real_store()

			tree.probe_folders(item, workspace.tree)
			await vi.waitFor(() => expect(tree.is_probing(item, mail().id)).toBe(false))

			expect(fm.FolderChildren).toHaveBeenCalledWith(mail().id)
			expect(mail().children_loaded).toBe(false)
			expect(workspace.last_error).toBeNull()
			expect(on_error).not.toHaveBeenCalled()
			expect(tree.has_chevron(item, mail(), false)).toBe(true)
		})

		test('refresh reads a cached folder again and picks up what Finder changed', async () => {
			const fake = createFakeFileManager()
			fake.seed_folder(LIB)
			fake.seed_folder(`${LIB}/Fonts`)
			const workspace = await createWorkspaceStore({ id: LIB, type: 'local', name: 'Library' }, fake.fm)
			if (!workspace) throw new Error('no store')
			live.push(workspace)
			await workspace.show_folder_children(`${LIB}/Fonts`)
			const fonts = () => workspace.tree.find(item => item.id === `${LIB}/Fonts`)!
			expect(fonts().children ?? []).toEqual([])

			fake.seed_folder(`${LIB}/Fonts/Added`)
			await workspace.show_folder_children(`${LIB}/Fonts`)
			expect(fonts().children ?? []).toEqual([])
			await workspace.show_folder_children(`${LIB}/Fonts`, undefined, { refresh: true })
			expect(fonts().children?.map(child => child.id)).toEqual([`${LIB}/Fonts/Added`])
		})

		test('a read without silent still reports the error', async () => {
			const { workspace, mail } = await real_store()

			await workspace.show_folder_children(mail().id)

			expect(workspace.last_error).toContain('os error 1')
		})

		test('opening it in the tree explains the error instead of the OS text', async () => {
			explorer_language.value = 'en'
			const { workspace, tree, item, on_error, mail } = await real_store()

			await tree.toggle_folder(item, mail())

			expect(workspace.last_error).toBeNull()
			expect(on_error).toHaveBeenCalledTimes(1)
			expect((on_error.mock.calls[0]![0] as Error).message).toContain('No access to the folder “Mail”')
			expect(workspace.is_folder_expanded(mail().id)).toBe(false)
		})
	})
})

describe('moving a folder to another root of the same drive', () => {
	const live: WorkspaceStore[] = []
	afterEach(() => {
		for (const store of live.splice(0)) store.dispose()
	})

	async function two_roots(kind: 'local' | 'cloud' = 'local') {
		const fake = createFakeFileManager()
		fake.seed_folder('/home')
		fake.seed_folder('/home/Projects')
		fake.seed_folder('/home/Projects/app')
		fake.seed_folder('/vol')
		fake.seed_folder('/vol/Backup')
		const stores = new Map<string, WorkspaceStore>()
		for (const id of ['/home', '/vol']) {
			const store = await createWorkspaceStore({ id, type: kind, name: id }, fake.fm, { root_folder_id: id })
			if (!store) throw new Error('no store')
			stores.set(id, store)
			live.push(store)
		}
		const drive: Drive = {
			id: kind,
			kind,
			name: kind,
			icon: '',
			trash: kind === 'cloud' ? 'page' : 'system',
			roots: async () => [
				{ id: '/home', name: 'Home', can_write: true },
				{ id: '/vol', name: 'vol', can_write: true },
			],
			store_for: async id => stores.get(id)!,
		}
		let location: ExplorerLocation | null = {
			kind: 'folder',
			ref: { drive_id: kind, root_id: '/home', folder_id: '/home/Projects/app' },
		}
		const open_folder = vi.fn(async (ref: FolderRef) => { location = { kind: 'folder', ref } })
		const on_error = vi.fn()
		const cloud_stamp_at = vi.fn(async (_workspace: string, path: string) => ({ entry_id: `row:${path}`, stamp: `stamp:${path}` }))
		let delete_result: 'deleted' | 'trashed' | 'changed' = 'deleted'
		const delete_moved_cloud_entry = vi.fn(async (row: string, _stamp: string, _path: string) => {
			if (delete_result !== 'changed') await fake.fm.remove(row.slice('row:'.length))
			return delete_result
		})
		const released: string[] = []
		const hold_root = vi.fn((root_id: string) => () => { released.push(root_id) })
		const tree = create_explorer_tree({
			current_location: () => location,
			open_folder,
			set_expanded: () => {},
			browser_workspaces: () => [],
			on_error,
			cloud_stamp_at,
			delete_moved_cloud_entry,
			hold_root,
		})
		await tree.show_drive(drive, null)
		const [home, vol] = tree.roots
		return {
			fake, stores, tree, home: home!, vol: vol!, open_folder, on_error, hold_root, released,
			cloud_stamp_at, delete_moved_cloud_entry,
			set_delete_result(result: typeof delete_result) { delete_result = result },
		}
	}

	test('the folder lands in the other root and navigation follows the current place', async () => {
		const { fake, stores, tree, home, vol, open_folder, on_error, hold_root, released } = await two_roots()
		await stores.get('/vol')!.show_folder_children('/vol/Backup')
		const projects = stores.get('/home')!.tree.find(node => node.id === '/home/Projects')!

		await tree.transfer_folder(home, projects, vol, '/vol/Backup')

		expect(on_error).not.toHaveBeenCalled()
		expect(fake.has('/vol/Backup/Projects/app')).toBe(true)
		expect(fake.has('/home/Projects')).toBe(false)
		expect(open_folder).toHaveBeenCalledWith({
			drive_id: 'local',
			root_id: '/vol',
			folder_id: '/vol/Backup/Projects/app',
		})
		// Both stores were held for the transfer and let go after it
		expect(hold_root.mock.calls.map(call => call[0])).toEqual(['/home', '/vol'])
		expect(released.sort()).toEqual(['/home', '/vol'])
	})

	test('a failure in the other store reaches the shell', async () => {
		const { stores, tree, home, vol, on_error } = await two_roots()
		const target = stores.get('/vol')!
		await target.show_folder_children('/vol/Backup')
		// A local pair falls back to copy + remove when the rename fails: fail both
		vi.spyOn(target.file_manager, 'move').mockRejectedValueOnce(new Error('cross-device link'))
		vi.spyOn(target.file_manager, 'copy_entry').mockRejectedValueOnce(new Error('disk full'))
		const projects = stores.get('/home')!.tree.find(node => node.id === '/home/Projects')!

		await tree.transfer_folder(home, projects, vol, '/vol/Backup')

		expect(on_error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('disk full') }))
		expect(target.last_error).toBeNull()
	})

	test('across cloud workspaces the source is stamped before the copy and removed by that stamp', async () => {
		const ok = await two_roots('cloud')
		await ok.stores.get('/vol')!.show_folder_children('/vol/Backup')
		const projects = ok.stores.get('/home')!.tree.find(node => node.id === '/home/Projects')!
		await ok.tree.transfer_folder(ok.home, projects, ok.vol, '/vol/Backup')

		expect(ok.on_error).not.toHaveBeenCalled()
		expect(ok.cloud_stamp_at).toHaveBeenCalledWith('/home', '/home/Projects')
		expect(ok.delete_moved_cloud_entry).toHaveBeenCalledWith('row:/home/Projects', 'stamp:/home/Projects', '/home/Projects')
		expect(ok.fake.has('/vol/Backup/Projects/app')).toBe(true)
		expect(ok.fake.has('/home/Projects')).toBe(false)
	})

	test('a source changed during the copy is kept, the copy stays, and the user hears why', async () => {
		const run = await two_roots('cloud')
		run.set_delete_result('changed')
		await run.stores.get('/vol')!.show_folder_children('/vol/Backup')
		const source = run.stores.get('/home')!
		const projects = source.tree.find(node => node.id === '/home/Projects')!
		await run.tree.transfer_folder(run.home, projects, run.vol, '/vol/Backup')

		expect(run.fake.has('/home/Projects/app')).toBe(true)
		expect(run.fake.has('/vol/Backup/Projects/app')).toBe(true)
		expect(source.tree.some(node => node.id === '/home/Projects')).toBe(true)
		expect(run.on_error).toHaveBeenCalledTimes(1)
		// Navigation stays: the current place was not moved
		expect(run.open_folder).not.toHaveBeenCalled()
	})

	test('a failed copy into a cloud root goes to its trash, and the source stays', async () => {
		const run = await two_roots('cloud')
		const target = run.stores.get('/vol')!
		await target.show_folder_children('/vol/Backup')
		run.fake.seed_file('/home/Projects/app/one.txt', '1')
		run.fake.seed_file('/home/Projects/app/two.txt', '2')
		const upload = run.fake.fm.upload_file.bind(run.fake.fm)
		let uploads = 0
		run.fake.fm.upload_file = async (...args) => {
			if (++uploads === 2) throw new Error('network lost')
			return upload(...args)
		}
		const remove = vi.spyOn(run.fake.fm, 'remove')
		const projects = run.stores.get('/home')!.tree.find(node => node.id === '/home/Projects')!
		await run.tree.transfer_folder(run.home, projects, run.vol, '/vol/Backup')

		// Someone may already have edited what landed: no hard delete there,
		// only the trash, where nothing is lost
		expect(remove).toHaveBeenCalledWith('/vol/Backup/Projects')
		expect(run.delete_moved_cloud_entry).not.toHaveBeenCalled()
		expect(run.fake.has('/home/Projects/app/one.txt')).toBe(true)
		expect(run.on_error).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('network lost') }))
	})

	test('a local move does not stamp anything', async () => {
		const { stores, tree, home, vol, cloud_stamp_at } = await two_roots()
		await stores.get('/vol')!.show_folder_children('/vol/Backup')
		const projects = stores.get('/home')!.tree.find(node => node.id === '/home/Projects')!
		await tree.transfer_folder(home, projects, vol, '/vol/Backup')
		expect(cloud_stamp_at).not.toHaveBeenCalled()
	})
})

describe('moving a nested cloud folder to the top level', () => {
	const live: WorkspaceStore[] = []
	afterEach(() => {
		for (const store of live.splice(0)) store.dispose()
	})

	async function cloud_tree() {
		const source_fake = createFakeFileManager()
		source_fake.seed_folder('/')
		source_fake.seed_folder('/34')
		source_fake.seed_folder('/34/New folder 1')
		source_fake.seed_file('/34/New folder 1/inside.txt', 'inside')
		const source = await createWorkspaceStore(
			{ id: 'ws-34', type: 'cloud', name: '34' },
			source_fake.fm,
			{ root_folder_id: '/' },
		)
		if (!source) throw new Error('no source store')
		live.push(source)
		await source.show_folder_children('/34')

		const roots: DriveRoot[] = [{ id: 'ws-34', name: '34', can_write: true }]
		const stores = new Map<string, WorkspaceStore>([['ws-34', source]])
		const target_fake = createFakeFileManager()
		target_fake.seed_folder('/')
		const create_cloud_root = vi.fn(async (name: string) => {
			const target = await createWorkspaceStore(
				{ id: 'ws-new', type: 'cloud', name },
				target_fake.fm,
				{ root_folder_id: '/' },
			)
			if (!target) throw new Error('no target store')
			live.push(target)
			stores.set('ws-new', target)
			roots.push({ id: 'ws-new', name, can_write: true })
			return 'ws-new'
		})
		const drive: Drive = {
			id: 'cloud',
			kind: 'cloud',
			name: 'Cloud',
			icon: '',
			trash: 'page',
			roots: async () => roots,
			store_for: async id => stores.get(id)!,
		}
		const open_folder = vi.fn(async (_ref: FolderRef) => {})
		const on_error = vi.fn()
		const cloud_stamp_at = vi.fn(async (_workspace: string, path: string) => ({
			entry_id: `row:${path}`,
			stamp: `stamp:${path}`,
		}))
		let delete_result: 'deleted' | 'changed' = 'deleted'
		const delete_moved_cloud_entry = vi.fn(async (row: string, _stamp: string, path: string) => {
			if (delete_result === 'deleted') await source_fake.fm.remove(path)
			return delete_result
		})
		const tree = create_explorer_tree({
			current_location: () => null,
			open_folder,
			set_expanded: () => {},
			browser_workspaces: () => [],
			on_error,
			create_cloud_root,
			cloud_stamp_at,
			delete_moved_cloud_entry,
			hold_root: () => () => {},
		})
		await tree.show_drive(drive, null)
		return {
			source_fake, target_fake, source, tree, item: tree.roots[0]!,
			create_cloud_root, open_folder, on_error, delete_moved_cloud_entry,
			set_delete_result(result: typeof delete_result) { delete_result = result },
		}
	}

	test('the contents land in a new root and the source folder disappears', async () => {
		const run = await cloud_tree()
		const folder = run.source.tree.find(item => item.id === '/34')!.children!
			.find(item => item.id === '/34/New folder 1')!

		await run.tree.transfer_folder_to_cloud_root(run.item, folder)

		expect(run.create_cloud_root).toHaveBeenCalledWith('New folder 1')
		expect(run.target_fake.has('/inside.txt')).toBe(true)
		expect(run.source_fake.has('/34/New folder 1')).toBe(false)
		expect(run.delete_moved_cloud_entry).toHaveBeenCalledWith(
			'row:/34/New folder 1',
			'stamp:/34/New folder 1',
			'/34/New folder 1',
		)
		expect(run.tree.roots.map(item => item.root.id)).toEqual(['ws-34', 'ws-new'])
		expect(run.open_folder).toHaveBeenCalledWith({ drive_id: 'cloud', root_id: 'ws-new', folder_id: '/' })
		expect(run.on_error).not.toHaveBeenCalled()
	})

	test('a source changed during the copy stays next to the new root', async () => {
		const run = await cloud_tree()
		run.set_delete_result('changed')
		const folder = run.source.tree.find(item => item.id === '/34')!.children!
			.find(item => item.id === '/34/New folder 1')!

		await run.tree.transfer_folder_to_cloud_root(run.item, folder)

		expect(run.target_fake.has('/inside.txt')).toBe(true)
		expect(run.source_fake.has('/34/New folder 1/inside.txt')).toBe(true)
		expect(run.on_error).toHaveBeenCalledTimes(1)
		expect((run.on_error.mock.calls[0]![0] as Error).message).toContain('New folder 1')
		expect(run.open_folder).not.toHaveBeenCalled()
	})
})

describe('moving a cloud root into another root', () => {
	const live: WorkspaceStore[] = []
	afterEach(() => {
		for (const store of live.splice(0)) store.dispose()
	})

	async function root_move() {
		const source_fake = createFakeFileManager()
		source_fake.seed_folder('/')
		source_fake.seed_folder('/nested')
		source_fake.seed_file('/inside.txt', 'inside')
		source_fake.seed_file('/.hidden.txt', 'hidden')
		const target_fake = createFakeFileManager()
		target_fake.seed_folder('/')
		const source = await createWorkspaceStore(
			{ id: 'ws-a', type: 'cloud', name: 'A' },
			source_fake.fm,
			{ root_folder_id: '/' },
		)
		const target = await createWorkspaceStore(
			{ id: 'ws-34', type: 'cloud', name: '34' },
			target_fake.fm,
			{ root_folder_id: '/' },
		)
		if (!source || !target) throw new Error('no store')
		live.push(source, target)
		const roots: DriveRoot[] = [
			{ id: 'ws-a', name: 'A', can_write: true },
			{ id: 'ws-34', name: '34', can_write: true },
		]
		const stores = new Map<string, WorkspaceStore>([['ws-a', source], ['ws-34', target]])
		const drive: Drive = {
			id: 'cloud',
			kind: 'cloud',
			name: 'Cloud',
			icon: '',
			trash: 'page',
			roots: async () => roots,
			store_for: async id => stores.get(id)!,
		}
		let location: ExplorerLocation | null = {
			kind: 'folder',
			ref: { drive_id: 'cloud', root_id: 'ws-a', folder_id: '/nested' },
		}
		const open_folder = vi.fn(async (ref: FolderRef) => { location = { kind: 'folder', ref } })
		const on_error = vi.fn()
		const delete_cloud_root = vi.fn(async (root_id: string) => {
			const index = roots.findIndex(root => root.id === root_id)
			if (index !== -1) roots.splice(index, 1)
		})
		const tree = create_explorer_tree({
			current_location: () => location,
			open_folder,
			set_expanded: () => {},
			browser_workspaces: () => [],
			on_error,
			delete_cloud_root,
			hold_root: () => () => {},
		})
		await tree.show_drive(drive, location.kind === 'folder' ? location.ref : null)
		return {
			tree, target_fake, open_folder, on_error, delete_cloud_root,
			item: tree.roots.find(item => item.root.id === 'ws-a')!,
			target: tree.roots.find(item => item.root.id === 'ws-34')!,
		}
	}

	test('the root becomes a folder and navigation follows its current branch', async () => {
		const run = await root_move()

		await run.tree.transfer_cloud_root(run.item, run.target, '/')

		expect(run.target_fake.has('/A/inside.txt')).toBe(true)
		expect(run.target_fake.has('/A/.hidden.txt')).toBe(true)
		expect(run.target_fake.has('/A/nested')).toBe(true)
		expect(run.delete_cloud_root).toHaveBeenCalledWith('ws-a')
		expect(run.tree.roots.map(item => item.root.id)).toEqual(['ws-34'])
		expect(run.open_folder).toHaveBeenCalledWith({
			drive_id: 'cloud',
			root_id: 'ws-34',
			folder_id: '/A/nested',
		})
		expect(run.on_error).not.toHaveBeenCalled()
	})
})

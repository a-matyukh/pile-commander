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

		test('children of ~ and of ~/Library are not read ahead and keep the chevron; deeper folders are', async () => {
			const { tree, workspaces } = await local_tree([{ id: HOME, name: 'Home', can_write: true }])
			const item = tree.roots[0]!
			const fm = workspaces.get(HOME)!.file_manager
			const library = node(`${HOME}/Library`, 'Library')
			const documents = node(`${HOME}/Documents`, 'Documents')
			const mail = node(`${HOME}/Library/Mail`, 'Mail')
			const safari = node(`${HOME}/Library/Safari`, 'Safari')
			const project = node(`${HOME}/Projects/app`, 'app')

			tree.probe_folders(item, [library, documents])
			tree.probe_folders(item, [mail, safari])
			tree.probe_folders(item, [project])
			await vi.waitFor(() => expect(tree.is_probing(item, project.id)).toBe(false))

			const read = vi.mocked(fm.FolderChildren).mock.calls.map(call => call[0])
			expect(read).toEqual([project.id])
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

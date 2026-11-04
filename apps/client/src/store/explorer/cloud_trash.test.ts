import { describe, expect, test, vi } from 'vitest'
import type { TrashEntry, TrashedWorkspace } from '@pile-commander/file-manager'
import cloud from '@/store/cloud'
import { create_cloud_trash } from './cloud_trash'
import { explorer_tree } from './tree'

function entry(path: string, deleted_at: string): TrashEntry {
	return { id: path, path, name: path.slice(1), kind: 'folder', size_bytes: null, deleted_at, subtree_bytes: 0, subtree_files: 0 }
}

function setup() {
	const trash: Record<string, TrashEntry[]> = {
		w1: [entry('/old', '2026-10-01T00:00:00Z')],
		w2: [entry('/new', '2026-10-20T00:00:00Z')],
		w3: [entry('/theirs', '2026-10-25T00:00:00Z')],
	}
	const source = {
		workspaces: [
			{ id: 'w1', name: 'Work' },
			{ id: 'w2', name: 'Home' },
			{ id: 'w3', name: 'Shared' },
		],
		role_of: (id: string) => (id === 'w3' ? 'viewer' : id === 'w2' ? 'editor' : 'owner'),
		fetch_trash: vi.fn(async (id: string) => trash[id] ?? []),
		restore: vi.fn(async () => true),
		purge: vi.fn(async () => false),
		purge_all: vi.fn(async (id: string) => { trash[id] = []; return true }),
		list_trashed: vi.fn(async (): Promise<TrashedWorkspace[]> => []),
		restore_trashed_workspace: vi.fn(async (_id: string) => true),
		purge_trashed_workspace: vi.fn(async (_id: string) => true),
	}
	return { source, trash: create_cloud_trash(source as never) }
}

describe('cloud trash', () => {
	test('gathers the trash of folders the user can change, newest first, with their folder', async () => {
		const { source, trash } = setup()
		await trash.load()
		expect(source.fetch_trash).not.toHaveBeenCalledWith('w3')
		expect(trash.state.items.map(item => [item.name, item.workspace_name])).toEqual([['new', 'Home'], ['old', 'Work']])
	})

	test('an item leaves the list only when the server did it', async () => {
		const { source, trash } = setup()
		await trash.load()
		const [newer, older] = trash.state.items
		await trash.purge(newer!)
		expect(trash.state.items).toHaveLength(2)
		await trash.restore(older!)
		expect(source.restore).toHaveBeenCalledWith('w1', '/old')
		expect(trash.state.items.map(item => item.name)).toEqual(['new'])
	})

	test('emptying clears every folder that had something in its trash', async () => {
		const { source, trash } = setup()
		await trash.load()
		await trash.empty()
		expect(source.purge_all.mock.calls.map(call => call[0]).sort()).toEqual(['w1', 'w2'])
		expect(trash.state.items).toEqual([])
	})

	test('a restored workspace leaves the list and shows up in the tree', async () => {
		const saved = { workspaces: cloud.workspaces.slice(), roles: { ...cloud.roles }, user: cloud.user }
		cloud.user = null
		cloud.workspaces = []
		cloud.roles = {}
		const { source, trash } = setup()
		const row: TrashedWorkspace = { id: 'ws-back', name: 'Harbor', deleted_at: '2026-10-01T00:00:00Z', size_bytes: 12 }
		source.list_trashed.mockResolvedValue([row])
		source.restore_trashed_workspace.mockImplementation(async () => {
			cloud.workspaces = [{ type: 'cloud', id: 'ws-back', name: 'Harbor' }]
			cloud.roles = { 'ws-back': 'owner' }
			return true
		})
		await trash.load()
		await trash.restore_workspace(row)
		expect(source.restore_trashed_workspace).toHaveBeenCalledWith('ws-back')
		expect(trash.state.workspaces).toEqual([])
		expect(explorer_tree.roots.map(root => root.root.id)).toContain('ws-back')
		cloud.workspaces = saved.workspaces
		cloud.roles = saved.roles
		cloud.user = saved.user
		explorer_tree.reset()
	})

	test('purging a workspace removes its row', async () => {
		const { source, trash } = setup()
		const row: TrashedWorkspace = { id: 'ws-gone', name: 'Old', deleted_at: '2026-10-01T00:00:00Z', size_bytes: 4 }
		source.list_trashed.mockResolvedValue([row])
		await trash.load()
		await trash.purge_workspace(row)
		expect(source.purge_trashed_workspace).toHaveBeenCalledWith('ws-gone')
		expect(trash.state.workspaces).toEqual([])
	})

	test('emptying purges every trashed workspace', async () => {
		const { source, trash } = setup()
		source.list_trashed.mockResolvedValue([
			{ id: 'ws-a', name: 'A', deleted_at: '2026-10-02T00:00:00Z', size_bytes: 1 },
			{ id: 'ws-b', name: 'B', deleted_at: '2026-10-01T00:00:00Z', size_bytes: 2 },
		])
		await trash.load()
		await trash.empty()
		expect(source.purge_trashed_workspace.mock.calls.map(call => call[0]).sort()).toEqual(['ws-a', 'ws-b'])
	})
})

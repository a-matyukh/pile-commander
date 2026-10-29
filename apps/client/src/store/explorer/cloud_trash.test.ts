import { describe, expect, test, vi } from 'vitest'
import type { TrashEntry } from '@pile-commander/file-manager'
import { create_cloud_trash } from './cloud_trash'

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
})

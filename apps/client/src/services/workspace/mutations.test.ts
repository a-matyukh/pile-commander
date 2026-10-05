import { describe, expect, test } from 'vitest'
import type { EntryWithXattrs, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import {
	apply_entry_created,
	apply_entry_removed,
	apply_id_changed,
	type WorkspaceState,
} from './mutations'

function entry(
	id: string,
	name: string,
	type: 'file' | 'folder',
): EntryWithXattrs {
	return { id, name, type, xattrs: [] }
}

function folder(
	id: string,
	name: string,
	children: EntryWithXattrs[] = [],
): FolderWithChildrenXattrs {
	return { id, name, type: 'folder', xattrs: [], children }
}

function make_state(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
	const root = folder('/ws', 'ws', [
		entry('/ws/docs', 'docs', 'folder'),
		entry('/ws/note.txt', 'note.txt', 'file'),
	])
	return {
		id: '/ws',
		tree: [],
		expanded_folder_ids: new Set<string>(),
		loading_folder_ids: new Set<string>(),
		tree_loaded_folder_ids: new Set<string>(['/ws']),
		selection: [],
		folders: { '/ws': root },
		opened_folder_id: '/ws',
		...overrides,
	}
}

describe('workspace mutations', () => {
	test('apply_entry_created appends child and refreshes tree', () => {
		const state = make_state()
		apply_entry_created(state, '/ws', entry('/ws/new.txt', 'new.txt', 'file'))

		expect(state.folders['/ws']!.children!.map(c => c.id)).toContain('/ws/new.txt')
		expect(state.tree.map(n => n.id)).toContain('/ws/new.txt')
	})

	test('apply_entry_created lays created xattrs over a child a refresh already registered', () => {
		const state = make_state()
		// a realtime refresh read the note before its position was known
		state.folders['/ws']!.children!.push({
			...entry('/ws/new.md', 'new.md', 'file'),
			xattrs: [{ name: 'is_preview', value: 'true' }, { name: 'color', value: 'red' }],
		})

		apply_entry_created(state, '/ws', {
			...entry('/ws/new.md', 'new.md', 'file'),
			xattrs: [
				{ name: 'is_preview', value: 'true' },
				{ name: 'position', value: '{"x":10,"y":20}' },
			],
		})

		const children = state.folders['/ws']!.children!.filter(c => c.id === '/ws/new.md')
		expect(children).toHaveLength(1)
		expect(Object.fromEntries(children[0]!.xattrs.map(x => [x.name, x.value]))).toEqual({
			is_preview: 'true',
			color: 'red',
			position: '{"x":10,"y":20}',
		})
	})

	test('apply_entry_created expands non-root parent', () => {
		const docs = folder('/ws/docs', 'docs', [])
		const state = make_state({
			folders: {
				'/ws': folder('/ws', 'ws', [entry('/ws/docs', 'docs', 'folder')]),
				'/ws/docs': docs,
			},
			tree_loaded_folder_ids: new Set(['/ws', '/ws/docs']),
		})

		apply_entry_created(state, '/ws/docs', entry('/ws/docs/a.txt', 'a.txt', 'file'))

		expect(state.expanded_folder_ids.has('/ws/docs')).toBe(true)
		expect(state.tree_loaded_folder_ids.has('/ws/docs')).toBe(true)
		expect(docs.children!.map(c => c.id)).toEqual(['/ws/docs/a.txt'])
	})

	test('apply_entry_removed clears selection, cache and parent children', () => {
		const docs = folder('/ws/docs', 'docs', [entry('/ws/docs/a.txt', 'a.txt', 'file')])
		const state = make_state({
			folders: {
				'/ws': folder('/ws', 'ws', [entry('/ws/docs', 'docs', 'folder')]),
				'/ws/docs': docs,
			},
			selection: ['/ws/docs'],
			expanded_folder_ids: new Set(['/ws/docs']),
			tree_loaded_folder_ids: new Set(['/ws', '/ws/docs']),
		})

		apply_entry_removed(state, '/ws/docs')

		expect(state.selection).toEqual([])
		expect(state.folders['/ws/docs']).toBeUndefined()
		expect(state.folders['/ws']!.children!.map(c => c.id)).toEqual([])
		expect(state.expanded_folder_ids.has('/ws/docs')).toBe(false)
	})

	test('apply_id_changed renames paths in sets, selection and cache', () => {
		const docs = folder('/ws/docs', 'docs', [])
		const state = make_state({
			folders: {
				'/ws': folder('/ws', 'ws', [entry('/ws/docs', 'docs', 'folder')]),
				'/ws/docs': docs,
			},
			selection: ['/ws/docs'],
			expanded_folder_ids: new Set(['/ws/docs']),
			tree_loaded_folder_ids: new Set(['/ws', '/ws/docs']),
		})

	apply_id_changed(state, '/ws/docs', '/ws/papers', 'papers')

	expect(state.selection).toEqual(['/ws/papers'])
	expect(state.expanded_folder_ids.has('/ws/papers')).toBe(true)
	expect(state.folders['/ws/papers']?.name).toBe('papers')
	expect(state.folders['/ws/docs']).toBeUndefined()
	expect(state.folders['/ws']!.children![0]).toMatchObject({
		id: '/ws/papers',
		name: 'papers',
	})
})

test('apply_id_changed cascades to cached descendants', () => {
	const state = make_state({
		folders: {
			'/ws': folder('/ws', 'ws', [entry('/ws/docs', 'docs', 'folder')]),
			'/ws/docs': folder('/ws/docs', 'docs', [
				entry('/ws/docs/a.txt', 'a.txt', 'file'),
				entry('/ws/docs/sub', 'sub', 'folder'),
			]),
			'/ws/docs/sub': folder('/ws/docs/sub', 'sub', [
				entry('/ws/docs/sub/deep.txt', 'deep.txt', 'file'),
			]),
		},
		opened_folder_id: '/ws/docs/sub',
		tree_loaded_folder_ids: new Set(['/ws', '/ws/docs', '/ws/docs/sub']),
	})

	apply_id_changed(state, '/ws/docs', '/ws/papers', 'papers')

	expect(state.folders['/ws/docs']).toBeUndefined()
	expect(state.folders['/ws/docs/sub']).toBeUndefined()

	const renamed = state.folders['/ws/papers']!
	expect(renamed.id).toBe('/ws/papers')
	expect(renamed.children!.map(c => [c.id, c.name])).toEqual([
		['/ws/papers/a.txt', 'a.txt'],
		['/ws/papers/sub', 'sub'],
	])

	const nested = state.folders['/ws/papers/sub']!
	expect(nested.id).toBe('/ws/papers/sub')
	expect(nested.name).toBe('sub')
	expect(nested.children!.map(c => c.id)).toEqual(['/ws/papers/sub/deep.txt'])

	expect(state.opened_folder_id).toBe('/ws/papers/sub')
	expect(state.tree_loaded_folder_ids.has('/ws/papers/sub')).toBe(true)
})
})

import { describe, expect, test } from 'vitest'
import type { EntryWithXattrs, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import {
	folder_ancestor_chain,
	is_descendant,
	project_tree,
	find_tree_node,
	type TreeProjectionState,
} from './tree'
import {
	normalize_workspace_id,
	parent_folder_id_from_node_id,
	rename_ids_in_set,
} from './paths'

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

describe('paths', () => {
	test('normalize_workspace_id strips trailing separators', () => {
		expect(normalize_workspace_id('/Users/a/demo folder')).toBe('/Users/a/demo folder')
		expect(normalize_workspace_id('/Users/a/demo folder/')).toBe('/Users/a/demo folder')
		expect(normalize_workspace_id('/Users/a/demo folder///')).toBe('/Users/a/demo folder')
		expect(normalize_workspace_id('C:\\ws\\docs\\')).toBe('C:\\ws\\docs')
		expect(normalize_workspace_id('/')).toBe('/')
		expect(normalize_workspace_id('\\')).toBe('\\')
	})

	test('parent_folder_id_from_node_id handles unix and windows separators', () => {
		expect(parent_folder_id_from_node_id('/ws/docs/a', '/ws')).toBe('/ws/docs')
		expect(parent_folder_id_from_node_id('C:\\ws\\docs\\a', 'C:\\ws')).toBe('C:\\ws\\docs')
		expect(parent_folder_id_from_node_id('/ws', '/ws')).toBe('/ws')
	})

	test('rename_ids_in_set renames id and descendants', () => {
		const set = new Set(['/ws/docs', '/ws/docs/a', '/ws/other'])
		rename_ids_in_set(set, '/ws/docs', '/ws/papers')
		expect([...set].sort()).toEqual(['/ws/other', '/ws/papers', '/ws/papers/a'])
	})

	test('folder_ancestor_chain builds path from workspace root to folder', () => {
		expect(folder_ancestor_chain('/ws', '/ws')).toEqual([])
		expect(folder_ancestor_chain('/ws/docs', '/ws')).toEqual(['/ws/docs'])
		expect(folder_ancestor_chain('/ws/pics/sub', '/ws')).toEqual(['/ws/pics', '/ws/pics/sub'])
		expect(folder_ancestor_chain('C:\\ws\\pics\\sub', 'C:\\ws')).toEqual([
			'C:\\ws\\pics',
			'C:\\ws\\pics\\sub',
		])
	})
})

describe('project_tree', () => {
	test('projects loaded folders and marks unloaded ones', () => {
		const state: TreeProjectionState = {
			id: '/ws',
			tree: [],
			folders: {
				'/ws': folder('/ws', 'ws', [
					entry('/ws/docs', 'docs', 'folder'),
					entry('/ws/note.txt', 'note.txt', 'file'),
				]),
				'/ws/docs': folder('/ws/docs', 'docs', [
					entry('/ws/docs/a.txt', 'a.txt', 'file'),
				]),
			},
			tree_loaded_folder_ids: new Set(['/ws/docs']),
		}

		const tree = project_tree(state)
		expect(tree.map(n => n.id)).toEqual(['/ws/docs', '/ws/note.txt'])

		const docs = find_tree_node(tree, '/ws/docs')
		expect(docs).toMatchObject({
			type: 'folder',
			children_loaded: true,
		})
		expect(docs?.children?.map(c => c.id)).toEqual(['/ws/docs/a.txt'])
	})
})

describe('is_descendant', () => {
	test('detects nested nodes including self', () => {
		const tree: WorkspaceTree = [{
			id: '/ws/docs',
			name: 'docs',
			type: 'folder',
			children_loaded: true,
			children: [{ id: '/ws/docs/a', name: 'a', type: 'file' }],
		}]
		expect(is_descendant(tree, '/ws/docs', '/ws/docs')).toBe(true)
		expect(is_descendant(tree, '/ws/docs', '/ws/docs/a')).toBe(true)
		expect(is_descendant(tree, '/ws/docs', '/ws/other')).toBe(false)
	})
})

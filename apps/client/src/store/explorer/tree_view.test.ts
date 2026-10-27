import { describe, expect, test } from 'vitest'
import type { FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import {
	entry_view,
	is_folder_shown,
	matching_folder_ids,
	sort_tree_children,
	type TreeFilterSources,
} from './tree_view'

const HOME = '/Users/me'

function sources(over: Partial<TreeFilterSources> = {}): TreeFilterSources {
	return {
		drive_id: 'local',
		root_id: HOME,
		root_folder_id: HOME,
		cloud: false,
		bookmarks: [],
		sync_roots: [],
		cloud_synced: false,
		cloud_shared: false,
		cloud_public_link: false,
		cloud_in_hub: false,
		folders: {},
		...over,
	}
}

const folder = (id: string, name = id.split('/').pop()!): WorkspaceTreeNode => ({ id, name, type: 'folder' })

describe('tree filter', () => {
	test('all filters nothing', () => {
		expect(matching_folder_ids('all', sources())).toBeNull()
		expect(is_folder_shown(`${HOME}/a`, null)).toBe(true)
	})

	test('bookmarked: the bookmark, the way to it and what is inside it are shown', () => {
		const matches = matching_folder_ids('bookmarked', sources({
			bookmarks: [
				{ drive_id: 'local', root_id: HOME, folder_id: `${HOME}/Projects/app` },
				{ drive_id: 'cloud', root_id: 'w1', folder_id: '/' },
			],
		}))
		expect([...matches!]).toEqual([`${HOME}/Projects/app`])
		expect(is_folder_shown(`${HOME}/Projects`, matches)).toBe(true)
		expect(is_folder_shown(`${HOME}/Projects/app/src`, matches)).toBe(true)
		expect(is_folder_shown(`${HOME}/Projects/other`, matches)).toBe(false)
		expect(is_folder_shown(`${HOME}/Music`, matches)).toBe(false)
	})

	test('synced: local links inside this root; a cloud root by its own link', () => {
		const local = matching_folder_ids('synced', sources({ sync_roots: [`${HOME}/Work`, '/Volumes/Disk/x'] }))
		expect([...local!]).toEqual([`${HOME}/Work`])

		const cloud = matching_folder_ids('synced', sources({ cloud: true, root_folder_id: '/', cloud_synced: true }))
		expect(is_folder_shown('/', cloud)).toBe(true)
		expect(is_folder_shown('/docs', cloud)).toBe(true)
		expect(matching_folder_ids('synced', sources({ cloud: true, root_folder_id: '/' }))!.size).toBe(0)
	})

	test('shared, public link and Hub are properties of a cloud root only', () => {
		const cloud = { cloud: true, root_folder_id: '/' }
		expect(matching_folder_ids('shared', sources({ ...cloud, cloud_shared: true }))!.has('/')).toBe(true)
		expect(matching_folder_ids('public_link', sources({ ...cloud, cloud_public_link: true }))!.has('/')).toBe(true)
		expect(matching_folder_ids('in_hub', sources({ ...cloud, cloud_in_hub: true }))!.has('/')).toBe(true)
		expect(matching_folder_ids('shared', sources({ cloud_shared: true }))!.size).toBe(0)
	})

	test('custom view: only folders already read are known', () => {
		const read: FolderWithChildrenXattrs = {
			id: HOME,
			name: 'me',
			type: 'folder',
			xattrs: [],
			children: [
				{ id: `${HOME}/Board`, name: 'Board', type: 'folder', xattrs: [{ name: 'view', value: '"board"' }] },
				{ id: `${HOME}/Plain`, name: 'Plain', type: 'folder', xattrs: [{ name: 'view', value: '"list"' }] },
				{ id: `${HOME}/note.md`, name: 'note.md', type: 'file', xattrs: [{ name: 'view', value: '"board"' }] },
			],
		}
		const matches = matching_folder_ids('custom_view', sources({ folders: { [HOME]: read } }))
		expect([...matches!]).toEqual([`${HOME}/Board`])
	})

	test('custom view: a root with its own view matches, and so does what is inside it', () => {
		const root: FolderWithChildrenXattrs = {
			id: '/',
			name: 'Board space',
			type: 'folder',
			xattrs: [{ name: 'view', value: '"board"' }],
			children: [{ id: '/plain', name: 'plain', type: 'folder', xattrs: [] }],
		}
		const matches = matching_folder_ids('custom_view', sources({ cloud: true, root_folder_id: '/', folders: { '/': root } }))
		expect(is_folder_shown('/', matches)).toBe(true)
		expect(is_folder_shown('/plain', matches)).toBe(true)
	})

	test('synced: a root that sits inside a linked folder matches as a whole', () => {
		const root_folder_id = '/Volumes/Disk/Work/Project'
		const matches = matching_folder_ids('synced', sources({
			root_id: root_folder_id,
			root_folder_id,
			sync_roots: ['/Volumes/Disk/Work'],
		}))
		expect(is_folder_shown(root_folder_id, matches)).toBe(true)
		expect(is_folder_shown(`${root_folder_id}/src`, matches)).toBe(true)
	})
})

describe('tree sort', () => {
	const nodes = [folder('/r/b10', 'b10'), folder('/r/B2', 'B2'), folder('/r/a', 'a')]
	const views: Record<string, string> = { '/r/a': 'canvas', '/r/b10': 'board' }
	const view_of = (node: WorkspaceTreeNode) => entry_view(views[node.id]
		? { xattrs: [{ name: 'view', value: JSON.stringify(views[node.id]) }] }
		: undefined)

	test('by name, numbers in order and case ignored; desc reverses', () => {
		const asc = sort_tree_children(nodes, { sort: 'name', direction: 'asc' }, view_of).map(node => node.name)
		expect(asc).toEqual(['a', 'B2', 'b10'])
		expect(sort_tree_children(nodes, { sort: 'name', direction: 'desc' }, view_of).map(node => node.name))
			.toEqual(['b10', 'B2', 'a'])
	})

	test('by kind follows the view menu order, then the name', () => {
		const kind = sort_tree_children(nodes, { sort: 'kind', direction: 'asc' }, view_of).map(node => node.name)
		expect(kind).toEqual(['B2', 'b10', 'a'])
	})
})

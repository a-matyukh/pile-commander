import { afterEach, describe, expect, test } from 'vitest'
import type { EntryWithXattrs, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import { show_hidden_files } from '@/store/showHiddenFiles'
import {
	children_orders_match,
	complete_visible_order,
	sort_entries_by_order_then_name,
	to_folder_container,
} from './folderContainer'

function entry(
	id: string,
	name: string,
	type: 'file' | 'folder',
	xattrs: { name: string; value: string }[] = [],
): EntryWithXattrs {
	return { id, name, type, xattrs }
}

afterEach(() => {
	show_hidden_files.value = false
})

function folder(
	id: string,
	name: string,
	children: EntryWithXattrs[] = [],
	xattrs: { name: string; value: string }[] = [],
): FolderWithChildrenXattrs {
	return { id, name, type: 'folder', xattrs, children }
}

describe('sort_entries_by_order_then_name', () => {
	test('orders by order xattr then name for unordered entries', () => {
		const sorted = sort_entries_by_order_then_name([
			entry('/ws/c', 'c.txt', 'file'),
			entry('/ws/a', 'a.txt', 'file', [{ name: 'order', value: '1' }]),
			entry('/ws/b', 'b.txt', 'file', [{ name: 'order', value: '0' }]),
			entry('/ws/d', 'd.txt', 'file'),
		])
		expect(sorted.map(e => e.name)).toEqual(['b.txt', 'a.txt', 'c.txt', 'd.txt'])
	})
})

describe('children_orders_match', () => {
	test('returns true when each id has matching order index', () => {
		const children = [
			entry('/ws/a', 'a', 'file', [{ name: 'order', value: '0' }]),
			entry('/ws/b', 'b', 'file', [{ name: 'order', value: '1' }]),
		]
		expect(children_orders_match(children, ['/ws/a', '/ws/b'])).toBe(true)
		expect(children_orders_match(children, ['/ws/b', '/ws/a'])).toBe(false)
		expect(children_orders_match(children, ['/ws/a'])).toBe(false)
	})
})

describe('to_folder_container', () => {
	test('maps folder xattrs and sorts children', () => {
		const container = to_folder_container(folder(
			'/ws',
			'ws',
			[
				entry('/ws/note.txt', 'note.txt', 'file', [
					{ name: 'is_preview', value: 'true' },
					{ name: 'order', value: '1' },
				]),
				entry('/ws/z.txt', 'z.txt', 'file', [{ name: 'order', value: '0' }]),
			],
			[{ name: 'view', value: '"board"' }],
		))

		expect(container.type).toBe('folder_container')
		expect(container.view).toBe('board')
		expect(container.children.map(c => c.name)).toEqual(['z.txt', 'note.txt'])
		expect(container.children[1]).toMatchObject({
			type: 'file',
			is_preview: true,
		})
	})

	test('embeds preview folders when cached', () => {
		const preview = folder('/ws/docs', 'docs', [
			entry('/ws/docs/a.txt', 'a.txt', 'file'),
		])
		const root = folder('/ws', 'ws', [
			entry('/ws/docs', 'docs', 'folder', [
				{ name: 'is_preview', value: 'true' },
				{ name: 'position', value: '{"x":5,"y":6}' },
			]),
		])

		const container = to_folder_container(root, { '/ws/docs': preview })
		const child = container.children[0]!
		expect(child.type).toBe('folder_container')
		expect(child).toMatchObject({
			id: '/ws/docs',
			is_preview: true,
			position: { x: 5, y: 6 },
		})
		if (child.type === 'folder_container') {
			expect(child.children.map(c => c.name)).toEqual(['a.txt'])
		}
	})

	test('hides names that start with a dot unless show hidden files is on', () => {
		const with_dot = folder('/ws', 'ws', [
			entry('/ws/note.txt', 'note.txt', 'file'),
			entry('/ws/.env', '.env', 'file'),
			entry('/ws/.git', '.git', 'folder'),
			entry('/ws/Thumbs.db', 'Thumbs.db', 'file'),
		])

		show_hidden_files.value = false
		expect(to_folder_container(with_dot).children.map(c => c.name)).toEqual([
			'note.txt',
			'Thumbs.db',
		])

		show_hidden_files.value = true
		expect(to_folder_container(with_dot).children.map(c => c.name)).toEqual([
			'.env',
			'.git',
			'note.txt',
			'Thumbs.db',
		])
	})

	test('hides a dotfile inside an embedded preview', () => {
		show_hidden_files.value = false
		const preview = folder('/ws/docs', 'docs', [
			entry('/ws/docs/a.txt', 'a.txt', 'file'),
			entry('/ws/docs/.git', '.git', 'folder'),
		])
		const root = folder('/ws', 'ws', [
			entry('/ws/docs', 'docs', 'folder', [
				{ name: 'is_preview', value: 'true' },
			]),
		])

		const container = to_folder_container(root, { '/ws/docs': preview })
		const child = container.children[0]!
		expect(child.type).toBe('folder_container')
		if (child.type === 'folder_container') {
			expect(child.children.map(c => c.name)).toEqual(['a.txt'])
		}
	})
})

describe('complete_visible_order', () => {
	afterEach(() => {
		show_hidden_files.value = false
	})

	test('appends hidden ids and rejects a list that drops a visible file', () => {
		const children = [
			entry('/ws/a', 'a.txt', 'file', [{ name: 'order', value: '0' }]),
			entry('/ws/git', '.git', 'folder', [{ name: 'order', value: '1' }]),
			entry('/ws/b', 'b.txt', 'file', [{ name: 'order', value: '2' }]),
		]

		expect(complete_visible_order(children, ['/ws/b', '/ws/a'])).toEqual([
			'/ws/b',
			'/ws/a',
			'/ws/git',
		])
		expect(complete_visible_order(children, ['/ws/a'])).toBeNull()
		expect(complete_visible_order(children, ['/ws/b', '/ws/a', '/ws/git'])).toEqual([
			'/ws/b',
			'/ws/a',
			'/ws/git',
		])
		expect(complete_visible_order(children, ['/ws/missing', '/ws/a'])).toBeNull()
	})
})

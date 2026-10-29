import { afterEach, describe, expect, test } from 'vitest'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { bookmarks, last_opened } from '@/store/workspaces_list'
import cloud from '@/store/cloud'
import { t } from '@/i18n'
import { BROWSER_ROOT } from './drives'
import {
	EXPLORER_BOOKMARKS_KEY,
	EXPLORER_LAST_OPENED_KEY,
	EXPLORER_LISTS_MIGRATED_KEY,
	add_bookmark,
	explorer_bookmarks,
	explorer_last_opened,
	explorer_lists_migrated,
	folder_ref_key,
	import_legacy_list,
	is_bookmarked,
	bookmark_name,
	legacy_item_to_folder_ref,
	migrate_explorer_lists,
	move_bookmark,
	read_folder_refs,
	remember_opened,
	remove_bookmark,
} from './bookmarks'

afterEach(() => {
	bookmarks.value = []
	last_opened.value = []
	explorer_bookmarks.value = []
	explorer_last_opened.value = []
	explorer_lists_migrated.value = false
})

describe('legacy bookmarks', () => {
	test('a root becomes a FolderRef, and a cloud root is /', () => {
		expect(legacy_item_to_folder_ref({
			type: 'local',
			id: '/Users/me/projects/a/',
			name: 'a',
		})).toEqual({
			drive_id: 'local',
			root_id: '/Users/me/projects/a',
			folder_id: '/Users/me/projects/a',
		})
		expect(legacy_item_to_folder_ref({
			type: 'cloud',
			id: 'ws-1',
			name: 'Notes',
		})).toEqual({
			drive_id: 'cloud',
			root_id: 'ws-1',
			folder_id: '/',
		})
	})

	test('demo is dropped, and a browser folder stays under the one browser root', () => {
		expect(legacy_item_to_folder_ref({
			type: 'demo',
			id: '/demo',
			name: 'Demo',
		})).toBeNull()
		expect(legacy_item_to_folder_ref({
			type: 'browser',
			id: '/browser-desktops/desk',
			name: 'desk',
		})).toEqual({
			drive_id: 'browser',
			root_id: BROWSER_ROOT,
			folder_id: '/browser-desktops/desk',
		})
		expect(BROWSER_ROOT).toBe('/browser-desktops')
	})

	test('drops missing paths and cloud workspaces that are gone', async () => {
		const list: WorkspacesListItem[] = [
			{ type: 'local', id: '/ok', name: 'ok' },
			{ type: 'local', id: '/gone/', name: 'gone' },
			{ type: 'browser', id: '/browser-desktops/gone', name: 'gone' },
			{ type: 'browser', id: '/browser-desktops/kept', name: 'kept' },
			{ type: 'cloud', id: 'live', name: 'Live' },
			{ type: 'cloud', id: 'dead', name: 'Dead' },
			{ type: 'demo', id: '/demo', name: 'Demo' },
		]
		const snapshot = list.map(item => ({ ...item }))

		const imported = await import_legacy_list(list, {
			exists: {
				local: async path => path === '/ok',
				browser: async path => path === '/browser-desktops/kept',
			},
			cloud_ids: new Set(['live']),
		})

		expect(list).toEqual(snapshot)
		expect(imported).toEqual([
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
			{ drive_id: 'browser', root_id: BROWSER_ROOT, folder_id: '/browser-desktops/kept' },
			{ drive_id: 'cloud', root_id: 'live', folder_id: '/' },
		])
	})

	test('keeps cloud entries when the cloud list is not known yet', async () => {
		const imported = await import_legacy_list(
			[{ type: 'cloud', id: 'ws-1', name: 'Notes' }],
			{ exists: {}, cloud_ids: null },
		)
		expect(imported).toEqual([
			{ drive_id: 'cloud', root_id: 'ws-1', folder_id: '/' },
		])
	})
})

describe('migrate_explorer_lists', () => {
	test('copies into the new keys once and leaves the old lists', async () => {
		expect(EXPLORER_BOOKMARKS_KEY).toBe('pile_commander_explorer_bookmarks')
		expect(EXPLORER_LAST_OPENED_KEY).toBe('pile_commander_explorer_last_opened')
		expect(EXPLORER_LISTS_MIGRATED_KEY).toBe('pile_commander_explorer_lists_migrated')

		bookmarks.value = [
			{ type: 'local', id: '/ok', name: 'ok' },
			{ type: 'local', id: '/gone', name: 'gone' },
			{ type: 'cloud', id: 'live', name: 'Live' },
			{ type: 'cloud', id: 'dead', name: 'Dead' },
		]
		last_opened.value = [
			{ type: 'local', id: '/ok', name: 'ok' },
			{ type: 'browser', id: '/browser-desktops/a', name: 'a' },
		]
		const old_bookmarks = bookmarks.value.map(item => ({ ...item }))
		const old_last = last_opened.value.map(item => ({ ...item }))

		await migrate_explorer_lists(new Set(['live']), {
			local: async path => path === '/ok',
			browser: async () => true,
		})

		expect(bookmarks.value).toEqual(old_bookmarks)
		expect(last_opened.value).toEqual(old_last)
		expect(explorer_bookmarks.value).toEqual([
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
			{ drive_id: 'cloud', root_id: 'live', folder_id: '/' },
		])
		expect(explorer_last_opened.value).toEqual([
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
			{ drive_id: 'browser', root_id: BROWSER_ROOT, folder_id: '/browser-desktops/a' },
		])

		bookmarks.value = []
		last_opened.value = []
		await migrate_explorer_lists(new Set(), { local: async () => false })
		expect(explorer_bookmarks.value).toEqual([
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
			{ drive_id: 'cloud', root_id: 'live', folder_id: '/' },
		])
		expect(bookmarks.value).toEqual([])
	})
})

describe('explorer bookmark list', () => {
	test('reads only folder addresses', () => {
		expect(read_folder_refs('nope')).toEqual([])
		expect(read_folder_refs('{"drive_id":"local"}')).toEqual([])
		expect(read_folder_refs(JSON.stringify([
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
			{ drive_id: 'local' },
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
		]))).toEqual([
			{ drive_id: 'local', root_id: '/ok', folder_id: '/ok' },
		])
	})

	test('adding a bookmark drops it from the recent list', () => {
		const folder = { drive_id: 'local', root_id: '/ok', folder_id: '/ok' }
		remember_opened(folder)
		expect(explorer_last_opened.value).toEqual([folder])
		add_bookmark(folder)
		expect(is_bookmarked(folder)).toBe(true)
		expect(explorer_bookmarks.value).toEqual([folder])
		expect(explorer_last_opened.value).toEqual([])
		remember_opened(folder)
		expect(explorer_last_opened.value).toEqual([])
		remove_bookmark(folder)
		expect(is_bookmarked(folder)).toBe(false)
	})

	test('names a local path by its folder, a browser folder from the old list, and a cloud root by its workspace', () => {
		const previous = cloud.workspaces.slice()
		bookmarks.value = [{ type: 'browser', id: '/browser-desktops/desk', name: 'Desk' }]
		cloud.workspaces = [{ type: 'cloud', id: 'ws-1', name: 'Shared' }]
		expect(bookmark_name({
			drive_id: 'local',
			root_id: '/Users/me/docs',
			folder_id: '/Users/me/docs',
		})).toBe('docs')
		expect(bookmark_name({
			drive_id: 'browser',
			root_id: BROWSER_ROOT,
			folder_id: '/browser-desktops/desk',
		})).toBe('Desk')
		expect(bookmark_name({
			drive_id: 'cloud',
			root_id: 'ws-1',
			folder_id: '/',
		})).toBe('Shared')
		cloud.workspaces = previous
	})

	test('names the browser storage root by the drive, not by its path', () => {
		expect(bookmark_name({
			drive_id: 'browser',
			root_id: BROWSER_ROOT,
			folder_id: BROWSER_ROOT,
		})).toBe(t('source.browser_disk'))
	})

	test('drag reorder moves a bookmark before or after another', () => {
		const a = { drive_id: 'local', root_id: '/a', folder_id: '/a' }
		const b = { drive_id: 'local', root_id: '/b', folder_id: '/b' }
		const c = { drive_id: 'local', root_id: '/c', folder_id: '/c' }
		explorer_bookmarks.value = [a, b, c]
		move_bookmark(folder_ref_key(c), folder_ref_key(a), true)
		expect(explorer_bookmarks.value).toEqual([a, c, b])
	})
})

describe('retarget_bookmarks', () => {
	test('bookmarks at and inside a moved folder follow it; others stay', async () => {
		const { explorer_bookmarks, retarget_bookmarks } = await import('./bookmarks')
		explorer_bookmarks.value = [
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Old' },
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Old/sub' },
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Older' },
		]
		retarget_bookmarks(
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Old' },
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old' },
		)
		expect(explorer_bookmarks.value).toEqual([
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old' },
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old/sub' },
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Older' },
		])
		explorer_bookmarks.value = []
	})
})

describe('forget_bookmarks', () => {
	test('bookmarks at and inside a trashed folder go away; a sibling with a longer name stays', async () => {
		const { explorer_bookmarks, forget_bookmarks } = await import('./bookmarks')
		explorer_bookmarks.value = [
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Old' },
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Old/sub' },
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Older' },
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/h/Old' },
		]
		forget_bookmarks({ drive_id: 'local', root_id: '/h', folder_id: '/h/Old' })
		expect(explorer_bookmarks.value).toEqual([
			{ drive_id: 'local', root_id: '/h', folder_id: '/h/Older' },
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/h/Old' },
		])
		explorer_bookmarks.value = []
	})
})

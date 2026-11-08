import { afterEach, describe, expect, test } from 'vitest'
import cloud from '@/store/cloud'
import { t } from '@/i18n'
import { BROWSER_ROOT } from './drives'
import {
	add_bookmark,
	explorer_bookmarks,
	explorer_last_opened,
	folder_ref_key,
	is_bookmarked,
	bookmark_name,
	move_bookmark,
	read_folder_refs,
	remember_opened,
	remove_bookmark,
} from './bookmarks'

afterEach(() => {
	explorer_bookmarks.value = []
	explorer_last_opened.value = []
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

	test('names a local path by its folder, a browser folder by its path, and a cloud root by its workspace', () => {
		const previous = cloud.workspaces.slice()
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
		})).toBe('desk')
		expect(bookmark_name({
			drive_id: 'cloud',
			root_id: 'ws-1',
			folder_id: '/',
		})).toBe('Shared')
		cloud.workspaces = []
		expect(bookmark_name({
			drive_id: 'cloud',
			root_id: 'ws-1',
			folder_id: '/',
		})).toBe(t('bookmarks.cloud_folder'))
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

	test('an undo of the delete brings them back to their places, under the name it came back with', async () => {
		const { explorer_bookmarks, forget_bookmarks, bring_back_bookmarks } = await import('./bookmarks')
		explorer_bookmarks.value = [
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/A' },
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old/sub' },
			{ drive_id: 'cloud', root_id: 'w1', folder_id: '/B' },
		]
		forget_bookmarks({ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old' })
		bring_back_bookmarks({ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old (1)' }, '/Old')
		expect(explorer_bookmarks.value.map(ref => ref.folder_id)).toEqual(['/A', '/Old (1)/sub', '/B'])
		// spent: a second undo has nothing to bring
		bring_back_bookmarks({ drive_id: 'cloud', root_id: 'w1', folder_id: '/Old' })
		expect(explorer_bookmarks.value).toHaveLength(3)
		explorer_bookmarks.value = []
	})
})

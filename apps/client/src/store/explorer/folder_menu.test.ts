import { afterEach, describe, expect, test, vi } from 'vitest'
import type { Drive, DriveRoot, FolderRef } from '@/domain/Drive'
import { BROWSER_ROOT } from './drives'
import { explorer_bookmarks, explorer_last_opened, is_bookmarked } from './bookmarks'
import { t } from '@/i18n'
import { create_child_folder, folder_menu_items, folder_menu_node, remove_confirm_text, reveal_in_finder, toggle_bookmark } from './folder_menu'
import { explorer_language } from './language'
import { explorer_tree, type ExplorerTreeRoot } from './tree'

const reveal = vi.hoisted(() => vi.fn(async (_path: string) => {}))
vi.mock('@tauri-apps/plugin-opener', () => ({ revealItemInDir: reveal }))

afterEach(() => {
	explorer_bookmarks.value = []
	explorer_last_opened.value = []
	reveal.mockClear()
	explorer_language.value = 'system'
})

const HOME = '/Users/me'

function tree_root(kind: Drive['kind'], root: DriveRoot): ExplorerTreeRoot {
	const drive = {
		id: kind,
		kind,
		name: kind,
		icon: 'tabler:folder',
		trash: kind === 'browser' ? null : {},
		roots: async () => [root],
		store_for: async () => { throw new Error('not used') },
	} as unknown as Drive
	return { drive, root, workspace: null, loading: false }
}

const home = tree_root('local', { id: HOME, name: 'Домашняя папка', can_write: true })
const browser = tree_root('browser', { id: BROWSER_ROOT, name: 'Browser storage', can_write: true })
const cloud_root = tree_root('cloud', { id: 'ws-1', name: '34', can_write: true })

const local = (folder_id: string): FolderRef => ({ drive_id: 'local', root_id: HOME, folder_id })
const writable = (item: ExplorerTreeRoot | null, desktop = true) => ({ item, can_write: true, desktop })

describe('folder header menu: items', () => {
	test('a folder in ~ on the desktop has every item', () => {
		expect(folder_menu_items(local(`${HOME}/Documents/A`), writable(home))).toEqual({
			rename: true,
			bookmarked: false,
			show_in_finder: true,
			move_to_trash: true,
		})
	})

	test('~ itself is neither renamed nor trashed, but can be bookmarked and shown in Finder', () => {
		expect(folder_menu_items(local(HOME), writable(home))).toEqual({
			rename: false,
			bookmarked: false,
			show_in_finder: true,
			move_to_trash: false,
		})
	})

	test('the browser drive root and a cloud top-level folder are roots too', () => {
		const browser_root: FolderRef = { drive_id: 'browser', root_id: BROWSER_ROOT, folder_id: BROWSER_ROOT }
		const cloud_top: FolderRef = { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/' }
		for (const [ref, item] of [[browser_root, browser], [cloud_top, cloud_root]] as const) {
			const items = folder_menu_items(ref, writable(item))
			expect(items.rename).toBe(false)
			expect(items.move_to_trash).toBe(false)
		}
	})

	test('a read-only folder has no rename and no trash', () => {
		const items = folder_menu_items(local(`${HOME}/Documents/A`), { item: home, can_write: false, desktop: true })
		expect(items.rename).toBe(false)
		expect(items.move_to_trash).toBe(false)
	})

	test('a legacy browser folder keeps its name but can be trashed', () => {
		const legacy: FolderRef = { drive_id: 'browser', root_id: BROWSER_ROOT, folder_id: `${BROWSER_ROOT}/old-id` }
		expect(folder_menu_items(legacy, writable(browser, false))).toMatchObject({ rename: false, move_to_trash: true })
		const nested: FolderRef = { ...legacy, folder_id: `${BROWSER_ROOT}/old-id/A` }
		expect(folder_menu_items(nested, writable(browser, false))).toMatchObject({ rename: true, move_to_trash: true })
	})

	test('"Show in Finder" only for the local drive on the desktop', () => {
		expect(folder_menu_items(local(`${HOME}/A`), writable(home, false)).show_in_finder).toBe(false)
		const cloud: FolderRef = { drive_id: 'cloud', root_id: 'ws-1', folder_id: '/34' }
		expect(folder_menu_items(cloud, writable(cloud_root)).show_in_finder).toBe(false)
	})

	test('no tree root listed for the folder: no rename and no trash', () => {
		const items = folder_menu_items(local(`${HOME}/A`), writable(null))
		expect(items.rename).toBe(false)
		expect(items.move_to_trash).toBe(false)
	})
})

describe('folder header menu: actions', () => {
	test('the bookmark item adds the open folder, then removes it', () => {
		const ref = local(`${HOME}/Documents/A`)
		toggle_bookmark(ref)
		expect(is_bookmarked(ref)).toBe(true)
		expect(folder_menu_items(ref, writable(home)).bookmarked).toBe(true)
		toggle_bookmark(ref)
		expect(is_bookmarked(ref)).toBe(false)
		expect(explorer_bookmarks.value).toEqual([])
	})

	test('"Show in Finder" reveals the folder path; other drives do nothing', async () => {
		await reveal_in_finder(local(`${HOME}/Documents/A`))
		expect(reveal).toHaveBeenCalledWith(`${HOME}/Documents/A`)
		await reveal_in_finder({ drive_id: 'cloud', root_id: 'ws-1', folder_id: '/34' })
		expect(reveal).toHaveBeenCalledTimes(1)
	})

	test('the open folder becomes a tree node named by its path', () => {
		expect(folder_menu_node(local(`${HOME}/Documents/A`))).toEqual({
			id: `${HOME}/Documents/A`,
			name: 'A',
			type: 'folder',
		})
	})
})

describe('folder menu: "Move to trash" confirmation', () => {
	const render = (trash: Drive['trash']) => {
		const text = remove_confirm_text(trash)
		return [t(text.title, { name: 'A' }), t(text.confirm)]
	}

	test('a drive with a trash asks to move the folder to the trash', () => {
		explorer_language.value = 'ru'
		expect(render('system')).toEqual(['Переместить «A» в корзину?', 'Переместить в корзину'])
		expect(render('page')).toEqual(['Переместить «A» в корзину?', 'Переместить в корзину'])
		explorer_language.value = 'en'
		expect(render('system')).toEqual(['Move “A” to trash?', 'Move to trash'])
	})

	test('a drive without a trash (browser storage) keeps "Delete permanently"', () => {
		explorer_language.value = 'ru'
		expect(render(null)).toEqual(['Удалить папку безвозвратно?', 'Удалить безвозвратно'])
		expect(t(remove_confirm_text(null).description, { name: 'A' })).toContain('«A»')
	})
})

describe('folder menu: new folder inside the open one', () => {
	test('goes through the tree, which expands the folder; at a root the root itself', async () => {
		const create = vi.spyOn(explorer_tree, 'create_folder').mockResolvedValue(undefined)
		await create_child_folder(local(`${HOME}/Documents/A`), home)
		expect(create).toHaveBeenLastCalledWith(home, { id: `${HOME}/Documents/A`, name: 'A', type: 'folder' })
		await create_child_folder(local(HOME), home)
		expect(create).toHaveBeenLastCalledWith(home, null)
		await create_child_folder(local(`${HOME}/Documents`), null)
		expect(create).toHaveBeenCalledTimes(2)
		create.mockRestore()
	})
})

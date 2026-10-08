import { describe, expect, test, vi } from 'vitest'
import { createWorkspaceStore } from './index'
import { createFakeFileManager } from '@pile-commander/file-manager'
import { refresh_cached_folder } from './helpers/refreshCachedFolder'
import { shape_template_svg, prepare_svg_for_preview } from '@/services/board/shapes'
import { LIVE_UPDATES_UNAVAILABLE } from './helpers/watchSubscribeError'

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

/**
 * Test workspace layout:
 *
 * /ws
 *   docs/        (folder, is_preview=true — ends up in preview_folders)
 *     a.txt
 *   pics/        (folder)
 *   note.txt
 */
async function makeStore() {
	const fake = createFakeFileManager()
	fake.seed_folder('/ws')
	fake.seed_folder('/ws/docs')
	fake.set_xattr('/ws/docs', 'is_preview', 'true')
	fake.seed_file('/ws/docs/a.txt')
	fake.seed_folder('/ws/pics')
	fake.seed_file('/ws/note.txt')

	const store = await createWorkspaceStore(
		{ id: '/ws', type: 'local', name: 'ws' },
		fake.fm,
	)
	if (!store) throw new Error('createWorkspaceStore returned null')
	return { fake, store }
}

/** Mirrors load_workspace: prefetches preview folders after store creation. */
async function makeStoreWithPreviews() {
	const result = await makeStore()
	await result.store.prefetch_preview_folders(result.store.opened_folder.children)
	return result
}

const tree_ids = (store: { tree: { id: string }[] }) => store.tree.map(n => n.id)

describe('createWorkspaceStore: initialization', () => {
	test('builds the tree from opened folder children sorted by name', async () => {
		const { store } = await makeStore()

		expect(store.id).toBe('/ws')
		expect(store.opened_folder.id).toBe('/ws')
		expect(tree_ids(store)).toEqual(['/ws/docs', '/ws/note.txt', '/ws/pics'])
	})

	test('prefetch_preview_folders caches folders with is_preview', async () => {
		const { store } = await makeStoreWithPreviews()

		expect(Object.keys(store.preview_folders)).toEqual(['/ws/docs'])
		expect(store.preview_folders['/ws/docs']!.children.map(c => c.id))
			.toEqual(['/ws/docs/a.txt'])
	})

	test('open_folder switches the opened folder, keeping the previous one cached', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder('/ws/docs')

		expect(store.opened_folder_id).toBe('/ws/docs')
		expect(store.opened_folder.id).toBe('/ws/docs')
		expect(store.preview_folders['/ws/docs']).toBeUndefined()
		expect(store.preview_folders['/ws']).toBeDefined()
	})
})

describe('createWorkspaceStore: folder navigation', () => {
	test('starts with an empty back stack at workspace root', async () => {
		const { store } = await makeStore()

		expect(store.opened_folder_id).toBe('/ws')
		expect(store.folder_back_stack).toEqual([])
		expect(store.can_go_back).toBe(false)
	})

	test('open_folder pushes the current folder onto the back stack', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder('/ws/docs')

		expect(store.can_go_back).toBe(true)
		expect(store.folder_back_stack).toEqual(['/ws'])
	})

	test('open_folder clears selection when switching folders', async () => {
		const { store } = await makeStoreWithPreviews()
		store.enter_selection_mode()
		store.set_selection(['/ws/note.txt'])

		await store.open_folder('/ws/docs')

		expect(store.selection).toEqual([])
		expect(store.selection_mode).toBe(false)
	})

	test('go_back returns through the navigation stack', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder('/ws/docs')
		await store.open_folder('/ws/pics')

		expect(store.opened_folder_id).toBe('/ws/pics')
		expect(store.folder_back_stack).toEqual(['/ws', '/ws/docs'])

		await store.go_back()
		expect(store.opened_folder_id).toBe('/ws/docs')
		expect(store.folder_back_stack).toEqual(['/ws'])

		await store.go_back()
		expect(store.opened_folder_id).toBe('/ws')
		expect(store.folder_back_stack).toEqual([])
		expect(store.can_go_back).toBe(false)
	})

	test('new navigation after go_back discards forward history', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder('/ws/docs')
		await store.open_folder('/ws/pics')
		await store.go_back()

		expect(store.opened_folder_id).toBe('/ws/docs')

		await store.open_folder('/ws/pics')

		expect(store.opened_folder_id).toBe('/ws/pics')
		expect(store.folder_back_stack).toEqual(['/ws', '/ws/docs'])

		await store.go_back()
		expect(store.opened_folder_id).toBe('/ws/docs')
	})

	test('remove of opened folder returns to root without recording history', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		await store.open_folder('/ws/docs')
		expect(store.folder_back_stack).toEqual(['/ws'])

		await store.remove('/ws/docs')

		expect(store.opened_folder_id).toBe('/ws')
		expect(store.folder_back_stack).toEqual(['/ws'])
		expect(fake.has('/ws/docs')).toBe(false)
	})

	test('open_folder expands the opened folder in the sidebar tree', async () => {
		const { store } = await makeStoreWithPreviews()

		expect(store.is_folder_expanded('/ws/docs')).toBe(false)

		await store.open_folder('/ws/docs')

		expect(store.is_folder_expanded('/ws/docs')).toBe(true)
	})

	test('open_folder expands nested folder ancestors in the sidebar tree', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/pics')
		fake.seed_folder('/ws/pics/sub')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		expect(store.is_folder_expanded('/ws/pics')).toBe(false)
		expect(store.is_folder_expanded('/ws/pics/sub')).toBe(false)

		await store.open_folder('/ws/pics/sub')

		expect(store.is_folder_expanded('/ws/pics')).toBe(true)
		expect(store.is_folder_expanded('/ws/pics/sub')).toBe(true)
		expect(store.tree_loaded_folder_ids.has('/ws/pics')).toBe(true)
	})
})

describe('createWorkspaceStore: folder tabs', () => {
	test('open_folder_in_new_tab appends a tab and activates it', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')

		expect(store.tabs.length).toBe(2)
		expect(store.tabs[0]!.folder_id).toBe('/ws')
		expect(store.tabs[1]!.folder_id).toBe('/ws/docs')
		expect(store.active_tab_id).toBe(store.tabs[1]!.id)
		expect(store.opened_folder_id).toBe('/ws/docs')
		// The new tab starts with its own empty history
		expect(store.folder_back_stack).toEqual([])
		expect(store.can_go_back).toBe(false)
	})

	test('back histories are isolated per tab', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder('/ws/docs')
		expect(store.folder_back_stack).toEqual(['/ws'])

		await store.open_folder_in_new_tab('/ws/pics')
		expect(store.opened_folder_id).toBe('/ws/pics')
		expect(store.folder_back_stack).toEqual([])

		await store.activate_tab(store.tabs[0]!.id)
		expect(store.opened_folder_id).toBe('/ws/docs')
		expect(store.folder_back_stack).toEqual(['/ws'])

		await store.go_back()
		expect(store.opened_folder_id).toBe('/ws')
	})

	test('activate_tab refetches the tab folder', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		await store.activate_tab(store.tabs[0]!.id)
		expect(store.opened_folder_id).toBe('/ws')

		// A background tab is not fs-watched: an external change is picked
		// up by the refetch on activation.
		fake.seed_file('/ws/docs/b.txt')
		await store.activate_tab(store.tabs[1]!.id)

		expect(store.opened_folder_id).toBe('/ws/docs')
		expect(store.opened_folder.children.map(c => c.id)).toContain('/ws/docs/b.txt')
	})

	test('close_tab is a no-op for the last remaining tab', async () => {
		const { store } = await makeStore()

		await store.close_tab(store.tabs[0]!.id)

		expect(store.tabs.length).toBe(1)
		expect(store.opened_folder_id).toBe('/ws')
	})

	test('closing the active tab activates the right neighbor', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		await store.open_folder_in_new_tab('/ws/pics')
		await store.activate_tab(store.tabs[1]!.id)
		expect(store.opened_folder_id).toBe('/ws/docs')

		await store.close_tab(store.tabs[1]!.id)

		expect(store.tabs.map(t => t.folder_id)).toEqual(['/ws', '/ws/pics'])
		expect(store.opened_folder_id).toBe('/ws/pics')
	})

	test('closing a background tab keeps the active folder', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		expect(store.opened_folder_id).toBe('/ws/docs')

		await store.close_tab(store.tabs[0]!.id)

		expect(store.tabs.length).toBe(1)
		expect(store.opened_folder_id).toBe('/ws/docs')
	})

	test('remove of a background tab folder closes that tab', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		await store.activate_tab(store.tabs[0]!.id)

		await store.remove('/ws/docs')

		expect(store.tabs.length).toBe(1)
		expect(store.tabs[0]!.folder_id).toBe('/ws')
		expect(store.opened_folder_id).toBe('/ws')
	})

	test('remove of the active tab folder closes it and activates a neighbor', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		expect(store.opened_folder_id).toBe('/ws/docs')

		await store.remove('/ws/docs')

		expect(store.tabs.length).toBe(1)
		expect(store.tabs[0]!.folder_id).toBe('/ws')
		expect(store.opened_folder_id).toBe('/ws')
	})

	test('rename rewrites the folder id of a background tab at the renamed folder', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		await store.activate_tab(store.tabs[0]!.id)

		await store.rename('/ws/docs', 'papers')

		expect(store.tabs[1]!.folder_id).toBe('/ws/papers')
		expect(store.opened_folder_id).toBe('/ws')
	})

	test('rename rewrites background tab back stacks, keeping them navigable', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.open_folder_in_new_tab('/ws/docs')
		await store.open_folder('/ws/pics')
		await store.activate_tab(store.tabs[0]!.id)

		await store.rename('/ws/docs', 'papers')

		expect(store.tabs[1]!.folder_id).toBe('/ws/pics')
		expect(store.tabs[1]!.back_stack).toEqual(['/ws/papers'])

		await store.activate_tab(store.tabs[1]!.id)
		await store.go_back()
		expect(store.opened_folder_id).toBe('/ws/papers')
	})
})

describe('createWorkspaceStore: creation', () => {
	test('create_note creates a file with is_preview, adds it to children and tree without selecting', async () => {
		const { fake, store } = await makeStore()

		const id = await store.create_note('/ws')

		expect(id).toBe('/ws/Note 1.md')
		expect(fake.has(id)).toBe(true)
		expect(fake.get_xattr(id, 'is_preview')).toBe('true')
		expect(store.opened_folder.children.some(c => c.id === id)).toBe(true)
		expect(tree_ids(store)).toContain(id)
		expect(store.is_selected(id)).toBe(false)
	})

	test('create_note writes position with the file in one fs call', async () => {
		const { fake, store } = await makeStore()
		fake.calls.length = 0

		const id = await store.create_note('/ws', { x: 10, y: 20 })

		expect(JSON.parse(fake.get_xattr(id, 'position')!)).toEqual({ x: 10, y: 20 })
		expect(fake.calls.map(c => c.method)).toEqual(['create_text_file'])
	})

	test('create_note after delete reuses the path without stale session content', async () => {
		const { fake, store } = await makeStore()

		const id = await store.create_note('/ws')
		await store.save_note_content(id, 'deleted body')
		store.content_caches.notes.set(id, 'deleted body')

		await store.remove(id)
		expect(fake.has(id)).toBe(false)

		const recreated = await store.create_note('/ws')
		expect(recreated).toBe(id)
		expect(await store.read_note_content(recreated)).toBe('')
		expect(await store.content_caches.notes.get(recreated, async () => 'should-not-load')).toBe('')
	})

	test('content caches are per store: identical paths across workspaces stay independent', async () => {
		const first = await makeStore()
		const second = await makeStore()

		await first.store.content_caches.notes.get('/ws/note.txt', async () => 'first copy')
		await second.store.content_caches.notes.get('/ws/note.txt', async () => 'second copy')

		expect(await first.store.content_caches.notes.get('/ws/note.txt', async () => 'stale')).toBe('first copy')
		expect(await second.store.content_caches.notes.get('/ws/note.txt', async () => 'stale')).toBe('second copy')

		// An external edit in one workspace must not invalidate the other's cache.
		second.fake.seed_file('/ws/note.txt', 'edited in second')
		second.fake.emit_watch_event('/ws', { kind: 'modify', ids: ['/ws/note.txt'] })
		await vi.waitFor(async () => {
			expect(await second.store.content_caches.notes.get('/ws/note.txt', async () => 'x')).toBe('x')
		})
		expect(await first.store.content_caches.notes.get('/ws/note.txt', async () => 'stale')).toBe('first copy')
	})

	test('create_folder with position writes the xattr and adds the entry to children and tree', async () => {
		const { fake, store } = await makeStore()

		const id = await store.create_folder('/ws', { x: 10, y: 20 })

		expect(id).toBe('/ws/New folder 1')
		expect(fake.has(id)).toBe(true)
		expect(fake.get_xattr(id, 'position')).toBe('{"x":10,"y":20}')
		expect(fake.get_xattr(id, 'view')).toBe('board')
		expect(store.opened_folder.children.some(c => c.id === id)).toBe(true)
		expect(tree_ids(store)).toContain(id)
	})

	test('create_folder with view writes the xattr and returns the new folder id', async () => {
		const { fake, store } = await makeStore()

		const id = await store.create_folder('/ws', undefined, { view: 'board' })

		expect(id).toBe('/ws/New folder 1')
		expect(fake.has(id)).toBe(true)
		expect(fake.get_xattr(id, 'view')).toBe('board')
		expect(store.opened_folder.children.some(c => c.id === id)).toBe(true)
	})
})

describe('createWorkspaceStore: rename', () => {
	test('updates fs, tree, opened folder children and selection', async () => {
		const { fake, store } = await makeStore()
		store.select('/ws/note.txt')

		await store.rename('/ws/note.txt', 'renamed.txt')

		expect(fake.has('/ws/renamed.txt')).toBe(true)
		expect(fake.has('/ws/note.txt')).toBe(false)
		expect(tree_ids(store)).toContain('/ws/renamed.txt')
		expect(tree_ids(store)).not.toContain('/ws/note.txt')

		const child = store.opened_folder.children.find(c => c.id === '/ws/renamed.txt')
		expect(child?.name).toBe('renamed.txt')
		expect(store.is_selected('/ws/renamed.txt')).toBe(true)
		expect(store.is_selected('/ws/note.txt')).toBe(false)
	})

	test('transfers the preview_folders key and expanded id when renaming a folder', async () => {
		const { store } = await makeStoreWithPreviews()
		store.toggle_folder_expanded('/ws/docs')

		await store.rename('/ws/docs', 'papers')

		expect(store.preview_folders['/ws/docs']).toBeUndefined()
		expect(store.preview_folders['/ws/papers']).toBeDefined()
		expect(store.preview_folders['/ws/papers']!.id).toBe('/ws/papers')
		expect(store.preview_folders['/ws/papers']!.name).toBe('papers')
		expect(store.is_folder_expanded('/ws/papers')).toBe(true)
		expect(store.is_folder_expanded('/ws/docs')).toBe(false)
	})

	test('rename cascades to cached children of the renamed folder', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		await store.open_folder('/ws/docs')

		await store.rename('/ws/docs', 'papers')

		expect(fake.has('/ws/papers/a.txt')).toBe(true)
		expect(store.folders['/ws/docs']).toBeUndefined()
		expect(store.opened_folder_id).toBe('/ws/papers')
		expect(store.opened_folder.children.map(c => c.id)).toEqual(['/ws/papers/a.txt'])
		expect(store.opened_folder.children[0]?.name).toBe('a.txt')
	})

	test('read_note_content for a stale path after rename stays quiet', async () => {
		const { store } = await makeStoreWithPreviews()
		await store.open_folder('/ws/docs')

		await store.rename('/ws/docs', 'papers')

		const content = await store.read_note_content('/ws/docs/a.txt')
		expect(content).toBe('')
		expect(store.last_error).toBeNull()
	})

	test('keeps canvas connections when renaming a connected child', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [
			{
				id: 'c1',
				from: '/ws/note.txt',
				to: '/ws/pics',
				is_animated: false,
			},
		])
		await store.ensure_connections('/ws')

		await store.rename('/ws/note.txt', 'renamed.txt')

		// a rename is a delete+insert: the deterministic id embeds the endpoints
		expect(store.connections_for('/ws')).toEqual([
			{
				id: '/ws/renamed.txt:default-/ws/pics:default',
				from: '/ws/renamed.txt',
				to: '/ws/pics',
				is_animated: false,
			},
		])
		expect(await fake.fm.connections.list_connections('/ws')).toEqual([
			{
				id: '/ws/renamed.txt:default-/ws/pics:default',
				from: '/ws/renamed.txt',
				to: '/ws/pics',
				is_animated: false,
			},
		])
	})
})

describe('createWorkspaceStore: remove', () => {
	test('clears the tree, opened folder children, selection and expanded', async () => {
		const { fake, store } = await makeStore()
		store.select('/ws/note.txt')

		await store.remove('/ws/note.txt')

		expect(fake.has('/ws/note.txt')).toBe(false)
		expect(tree_ids(store)).not.toContain('/ws/note.txt')
		expect(store.opened_folder.children.some(c => c.id === '/ws/note.txt')).toBe(false)
		expect(store.is_selected('/ws/note.txt')).toBe(false)
	})

	test('clears preview folder children', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		await store.remove('/ws/docs/a.txt')

		expect(fake.has('/ws/docs/a.txt')).toBe(false)
		expect(store.preview_folders['/ws/docs']!.children.some(c => c.id === '/ws/docs/a.txt'))
			.toBe(false)
	})

	test('does not re-read removed shape content for cache subscribers', async () => {
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/shape.svg', shape_template_svg('rect'))

		// Mirror useShapeContent: primed cache plus a subscriber that
		// reloads when the cache signals a miss (undefined).
		const load = vi.fn(async () =>
			prepare_svg_for_preview(await store.read_note_content('/ws/shape.svg')))
		await store.content_caches.shapes.get('/ws/shape.svg', load)
		store.content_caches.shapes.subscribe('/ws/shape.svg', (value) => {
			if (value === undefined) {
				void store.content_caches.shapes.get('/ws/shape.svg', load)
			}
		})

		await store.remove('/ws/shape.svg')

		expect(load).toHaveBeenCalledTimes(1)
		expect(store.last_error).toBeNull()
	})
})

describe('createWorkspaceStore: move', () => {
	test('relocates an entry to another folder: fs, tree, children of both folders', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		const new_id = await store.move('/ws/note.txt', '/ws/docs', 0)

		expect(new_id).toBe('/ws/docs/note.txt')
		expect(fake.has('/ws/docs/note.txt')).toBe(true)
		expect(fake.has('/ws/note.txt')).toBe(false)

		expect(tree_ids(store)).not.toContain('/ws/note.txt')
		const docs_node = store.tree.find(n => n.id === '/ws/docs')
		expect(docs_node?.children?.map(c => c.id)).toContain('/ws/docs/note.txt')

		expect(store.opened_folder.children.some(c => c.id === '/ws/note.txt')).toBe(false)
		expect(store.preview_folders['/ws/docs']!.children.some(c => c.id === '/ws/docs/note.txt'))
			.toBe(true)
	})

	test('reverts the tree when the fs move fails', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.fail_once('move')

		const result = await store.move('/ws/note.txt', '/ws/docs', 0)

		expect(result).toBeUndefined()
		expect(fake.has('/ws/note.txt')).toBe(true)
		expect(tree_ids(store)).toContain('/ws/note.txt')
		const docs_node = store.tree.find(n => n.id === '/ws/docs')
		expect(docs_node?.children?.map(c => c.id) ?? []).not.toContain('/ws/docs/note.txt')
	})
})

describe('createWorkspaceStore: clipboard', () => {
	test('cut + paste moves into another folder and clears the clipboard', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		store.cut_entries(['/ws/note.txt'])
		expect(store.clipboard).toEqual({
			mode: 'cut',
			source_folder_id: '/ws',
			entry_ids: ['/ws/note.txt'],
		})

		await store.open_folder('/ws/pics')
		await store.paste()

		expect(fake.has('/ws/pics/note.txt')).toBe(true)
		expect(fake.has('/ws/note.txt')).toBe(false)
		expect(store.clipboard).toBeNull()
		expect(store.opened_folder.children.some(c => c.id === '/ws/pics/note.txt')).toBe(true)
	})

	test('copy + paste duplicates and clears the clipboard', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		store.copy_entries(['/ws/note.txt'])
		await store.open_folder('/ws/pics')
		await store.paste()

		expect(fake.has('/ws/note.txt')).toBe(true)
		expect(fake.has('/ws/pics/note.txt')).toBe(true)
		expect(store.clipboard).toBeNull()
		expect(store.opened_folder.children.some(c => c.id === '/ws/pics/note.txt')).toBe(true)
	})

	test('copy + paste into the source folder creates a unique duplicate', async () => {
		const { fake, store } = await makeStore()

		store.copy_entries(['/ws/note.txt'])
		await store.paste()

		expect(fake.has('/ws/note.txt')).toBe(true)
		expect(fake.has('/ws/note (1).txt')).toBe(true)
		expect(store.clipboard).toBeNull()
		expect(store.opened_folder.children.some(c => c.id === '/ws/note (1).txt')).toBe(true)
	})

	test('cut + paste in the source folder is a no-op', async () => {
		const { fake, store } = await makeStore()

		store.cut_entries(['/ws/note.txt'])
		await store.paste()

		expect(fake.has('/ws/note.txt')).toBe(true)
		expect(fake.calls.some(c => c.method === 'move' || c.method === 'copy_entry')).toBe(false)
		expect(store.clipboard?.entry_ids).toEqual(['/ws/note.txt'])
	})

	test('duplicate_entries creates a unique copy without touching the clipboard', async () => {
		const { fake, store } = await makeStore()

		store.copy_entries(['/ws/note.txt'])
		await store.duplicate_entries(['/ws/note.txt'])

		expect(fake.has('/ws/note.txt')).toBe(true)
		expect(fake.has('/ws/note (1).txt')).toBe(true)
		expect(store.clipboard).toEqual({
			mode: 'copy',
			source_folder_id: '/ws',
			entry_ids: ['/ws/note.txt'],
		})
		expect(store.opened_folder.children.some(c => c.id === '/ws/note (1).txt')).toBe(true)
	})

	test('duplicate_entries offsets position xattr so the copy is not stacked', async () => {
		const { fake, store } = await makeStore()
		fake.set_xattr('/ws/note.txt', 'position', JSON.stringify({ x: 40, y: 60 }))
		await store.open_folder('/ws')

		await store.duplicate_entries(['/ws/note.txt'])

		expect(fake.get_xattr('/ws/note.txt', 'position')).toBe(JSON.stringify({ x: 40, y: 60 }))
		expect(fake.get_xattr('/ws/note (1).txt', 'position')).toBe(
			JSON.stringify({ x: 64, y: 84 }),
		)
		const duplicated = store.opened_folder.children.find(c => c.id === '/ws/note (1).txt')
		expect(duplicated?.xattrs.find(a => a.name === 'position')?.value).toBe(
			JSON.stringify({ x: 64, y: 84 }),
		)
	})

	test('duplicate_entries prefetches preview folder data for is_preview copies', async () => {
		const { store } = await makeStoreWithPreviews()

		await store.duplicate_entries(['/ws/docs'])

		const copy_id = '/ws/docs (1)'
		expect(store.preview_folders[copy_id]).toBeDefined()
		expect(store.preview_folders[copy_id]!.children.map(c => c.id))
			.toEqual(['/ws/docs (1)/a.txt'])

		const widget = store.folder_container.children.find(c => c.id === copy_id)
		expect(widget?.type).toBe('folder_container')
	})
})

describe('createWorkspaceStore: uncombine_folder', () => {
	test('moves children to the parent and removes the folder', async () => {
		const { fake, store } = await makeStoreWithPreviews()

		await store.uncombine_folder('/ws/docs')

		expect(fake.has('/ws/docs')).toBe(false)
		expect(fake.has('/ws/a.txt')).toBe(true)
		expect(store.opened_folder.children.some(c => c.id === '/ws/docs')).toBe(false)
		expect(store.opened_folder.children.some(c => c.id === '/ws/a.txt')).toBe(true)
		expect(tree_ids(store)).toContain('/ws/a.txt')
		expect(tree_ids(store)).not.toContain('/ws/docs')
	})

	test('is a no-op for the workspace root', async () => {
		const { fake, store } = await makeStore()

		await store.uncombine_folder('/ws')

		expect(fake.has('/ws')).toBe(true)
		expect(fake.has('/ws/note.txt')).toBe(true)
	})

	test('restores absolute child positions when folder had spatial placement', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/combined')
		fake.set_xattr('/ws/combined', 'is_preview', 'true')
		fake.set_xattr('/ws/combined', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/combined', 'view', 'board')
		fake.seed_file('/ws/combined/a.txt')
		// Child keeps its in-folder coords; uncombine adds folder position.
		fake.set_xattr('/ws/combined/a.txt', 'position', JSON.stringify({ x: 20, y: 20 }))
		fake.set_xattr('/ws/combined/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/combined/b.txt')
		fake.set_xattr('/ws/combined/b.txt', 'position', JSON.stringify({ x: 170, y: 140 }))
		fake.set_xattr('/ws/combined/b.txt', 'is_preview', 'true')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')
		await store.prefetch_preview_folders(store.opened_folder.children)

		await store.uncombine_folder('/ws/combined')

		expect(fake.has('/ws/combined')).toBe(false)
		expect(fake.get_xattr('/ws/a.txt', 'position')).toBe('{"x":120,"y":120}')
		expect(fake.get_xattr('/ws/b.txt', 'position')).toBe('{"x":270,"y":240}')
	})

	test('uncombine reads folder position from folder own xattrs when parent entry lacks it', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/combined')
		fake.set_xattr('/ws/combined', 'is_preview', 'true')
		fake.set_xattr('/ws/combined', 'view', 'board')
		// Position only on the folder node itself (not mirrored on a separate attr source).
		fake.set_xattr('/ws/combined', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.seed_file('/ws/combined/a.txt')
		fake.set_xattr('/ws/combined/a.txt', 'position', JSON.stringify({ x: 20, y: 20 }))
		fake.set_xattr('/ws/combined/a.txt', 'is_preview', 'true')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')
		await store.prefetch_preview_folders(store.opened_folder.children)

		// Simulate parent child entry losing its position xattr while the folder
		// node itself still has one (own folders[id].xattrs).
		const parent_child = store.folders['/ws']!.children!.find(c => c.id === '/ws/combined')
		if (parent_child) {
			parent_child.xattrs = parent_child.xattrs.filter(a => a.name !== 'position')
		}

		await store.uncombine_folder('/ws/combined')

		expect(fake.get_xattr('/ws/a.txt', 'position')).toBe('{"x":120,"y":120}')
	})

	test('combine then uncombine restores origin widget as folder + relative pad', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/a.txt')
		fake.set_xattr('/ws/a.txt', 'position', JSON.stringify({ x: 100, y: 100 }))
		fake.set_xattr('/ws/a.txt', 'is_preview', 'true')
		fake.seed_file('/ws/b.txt')
		fake.set_xattr('/ws/b.txt', 'position', JSON.stringify({ x: 250, y: 220 }))
		fake.set_xattr('/ws/b.txt', 'is_preview', 'true')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		const origin = { x: 100, y: 100 }
		const newId = await store.create_folder('/ws', origin, { view: 'board' })
		expect(newId).toBeTruthy()

		const movedA = await store.move('/ws/a.txt', newId, 0, '/ws')
		const movedB = await store.move('/ws/b.txt', newId, 1, '/ws')
		expect(movedA).toBeTruthy()
		expect(movedB).toBeTruthy()

		// Same relative rewrite combineSelected applies (origin + TILE.pad inset).
		await store.change_position(movedA!, { x: 20, y: 20 })
		await store.change_position(movedB!, { x: 170, y: 140 })
		await store.change_is_preview(newId, true)

		await store.uncombine_folder(newId)

		// Origin widget must get folder offset, not stay at in-folder (20,20).
		expect(fake.get_xattr('/ws/a.txt', 'position')).toBe('{"x":120,"y":120}')
		expect(fake.get_xattr('/ws/b.txt', 'position')).toBe('{"x":270,"y":240}')
	})
})

describe('createWorkspaceStore: error reporting', () => {
	test('failed fs operation sets last_error and keeps the state intact', async () => {
		const { fake, store } = await makeStore()
		expect(store.last_error).toBeNull()
		fake.fail_once('rename')

		await store.rename('/ws/note.txt', 'renamed.txt')

		expect(store.last_error).toContain('rename')
		expect(fake.has('/ws/note.txt')).toBe(true)
		expect(tree_ids(store)).toContain('/ws/note.txt')
	})
})

describe('createWorkspaceStore: reorder_children', () => {
	test('writes order xattrs and reorders children and tree', async () => {
		const { fake, store } = await makeStore()
		const new_order = ['/ws/pics', '/ws/docs', '/ws/note.txt']

		await store.reorder_children('/ws', new_order)

		expect(fake.get_xattr('/ws/pics', 'order')).toBe('0')
		expect(fake.get_xattr('/ws/docs', 'order')).toBe('1')
		expect(fake.get_xattr('/ws/note.txt', 'order')).toBe('2')
		expect(store.opened_folder.children.map(c => c.id)).toEqual(new_order)
		expect(tree_ids(store)).toEqual(new_order)
	})
})

describe('createWorkspaceStore: preview toggle', () => {
	test('change_is_preview on svg file does not call folder_with_children_xattrs for the file id', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_file('/ws/shape.svg', shape_template_svg('ellipse'))

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		const folderCalls: string[] = []
		const original = fake.fm.folder_with_children_xattrs.bind(fake.fm)
		fake.fm.folder_with_children_xattrs = async (id: string) => {
			folderCalls.push(id)
			return original(id)
		}

		await store.change_is_preview('/ws/shape.svg', true)

		expect(store.last_error).toBeNull()
		expect(fake.get_xattr('/ws/shape.svg', 'is_preview')).toBe('true')
		expect(folderCalls).not.toContain('/ws/shape.svg')
	})

	test('change_is_preview on preview folder still prefetches folder data', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/embed')
		fake.set_xattr('/ws/embed', 'is_preview', 'false')

		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		await store.change_is_preview('/ws/embed', true)

		expect(store.last_error).toBeNull()
		expect(fake.get_xattr('/ws/embed', 'is_preview')).toBe('true')
		expect(store.preview_folders['/ws/embed']).toBeDefined()
	})
})

describe('createWorkspaceStore: shape fill', () => {
	test('change_shape_fill updates svg file content', async () => {
		const { fake, store } = await makeStore()
		await store.change_folder_view('/ws', 'board')

		const id = await store.create_shape('/ws', 'triangle')
		expect(id).toBeTruthy()

		await store.change_shape_fill(id, '#ff0000')

		const content = await fake.fm.read_text_file(id)
		expect(content).toContain('fill="#ff0000"')
	})

	test('create_shape line defaults to end arrow; plugs and geometry update', async () => {
		const { fake, store } = await makeStore()
		await store.change_folder_view('/ws', 'board')

		const id = await store.create_shape('/ws', 'line', { x: 0, y: 0 })
		expect(id).toBeTruthy()

		let content = await fake.fm.read_text_file(id)
		expect(content).toContain('data-pc-line="1"')
		expect(content).toContain('data-end-plug="arrow"')

		await store.change_line_plugs(id, { startPlug: 'arrow', endPlug: 'none' })
		content = await fake.fm.read_text_file(id)
		expect(content).toContain('data-start-plug="arrow"')
		expect(content).toContain('data-end-plug="none"')

		await store.change_line_geometry(id, {
			position: { x: 40, y: 60 },
			size: { width: 80, height: 40 },
			flipX: true,
			flipY: false,
		})
		content = await fake.fm.read_text_file(id)
		expect(content).toContain('data-flip-x="1"')
		expect(content).toContain('viewBox="0 0 80 40"')
		expect(fake.get_xattr(id, 'position')).toBe(JSON.stringify({ x: 40, y: 60 }))
		expect(fake.get_xattr(id, 'size')).toBe(JSON.stringify({ width: 80, height: 40 }))
	})
})

describe('createWorkspaceStore: create_line', () => {
	test('horizontal drag creates plain line with derived layout', async () => {
		const { fake, store } = await makeStore()
		await store.change_folder_view('/ws', 'board')

		const id = await store.create_line('/ws', { x: 10, y: 20 }, { x: 130, y: 20 })
		expect(id).toBeTruthy()

		const content = await fake.fm.read_text_file(id)
		expect(content).toContain('data-pc-line="1"')
		expect(content).toContain('data-end-plug="none"')
		expect(content).toContain('viewBox="0 0 120 8"')
		expect(fake.get_xattr(id, 'position')).toBe(JSON.stringify({ x: 10, y: 16 }))
		expect(fake.get_xattr(id, 'size')).toBe(JSON.stringify({ width: 120, height: 8 }))
	})

	test('arrow plug and diagonal flips are encoded in svg', async () => {
		const { fake, store } = await makeStore()
		await store.change_folder_view('/ws', 'board')

		const id = await store.create_line(
			'/ws',
			{ x: 100, y: 100 },
			{ x: 0, y: 0 },
			'arrow',
		)
		expect(id).toBeTruthy()

		const content = await fake.fm.read_text_file(id)
		expect(content).toContain('data-end-plug="arrow"')
		expect(content).toContain('data-flip-x="1"')
		expect(content).toContain('data-flip-y="1"')
		expect(content).toContain('data-axis="d"')
		expect(content).toContain('viewBox="0 0 100 100"')
		expect(content).toContain('pc-line-head')
		expect(fake.get_xattr(id, 'position')).toBe(JSON.stringify({ x: 0, y: 0 }))
		expect(fake.get_xattr(id, 'size')).toBe(JSON.stringify({ width: 100, height: 100 }))
	})
})

describe('createWorkspaceStore: watch', () => {
	test('after-subscribe realtime race does not set last_error', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.fm.watch = async () => {
			throw new Error(
				"cannot add 'postgres_changes' callbacks for realtime:file-manager-watch:ws:1 after 'subscribe()'.",
			)
		}
		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')
		expect(store.last_error).toBeNull()
	})

	test('watch subscribe failure sets a readable last_error', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.fm.watch = async () => {
			throw new Error('entries watch subscribe failed: CHANNEL_ERROR')
		}
		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
		)
		if (!store) throw new Error('createWorkspaceStore returned null')
		expect(store.last_error).toBe(LIVE_UPDATES_UNAVAILABLE)
	})

	test('change_folder_view updates opened folder view in memory', async () => {
		const { fake, store } = await makeStore()
		await store.open_folder('/ws/pics')

		await store.change_folder_view('/ws/pics', 'grid')

		expect(fake.get_xattr('/ws/pics', 'view')).toBe('grid')
		expect(store.folder_container.view).toBe('grid')
	})

	test('stale watch refresh during change_folder_view does not revert view', async () => {
		const { fake, store } = await makeStore()
		await store.open_folder('/ws/pics')

		const original = fake.fm.folder_with_children_xattrs.bind(fake.fm)
		let release_stale: (() => void) | undefined
		const stale_gate = new Promise<void>(resolve => {
			release_stale = resolve
		})

		fake.fm.folder_with_children_xattrs = async (id: string) => {
			if (id === '/ws/pics') {
				const snapshot = await original(id)
				await stale_gate
				return snapshot
			}
			return original(id)
		}

		const refresh = refresh_cached_folder(
			store,
			fake.fm,
			'/ws/pics',
			{ kind: 'modify', ids: ['/ws/pics'] },
		)

		await store.change_folder_view('/ws/pics', 'board')
		release_stale!()
		await refresh

		expect(fake.get_xattr('/ws/pics', 'view')).toBe('board')
		expect(store.folder_container.view).toBe('board')
	})

	test('post-write watch refresh with stale disk snapshot keeps local view', async () => {
		const { fake, store } = await makeStore()
		await store.open_folder('/ws/pics')

		const original = fake.fm.folder_with_children_xattrs.bind(fake.fm)
		fake.fm.folder_with_children_xattrs = async (id: string) => {
			const data = await original(id)
			if (id === '/ws/pics') {
				// Pretend FSEvents refresh still sees the pre-write xattrs.
				return {
					...data,
					xattrs: data.xattrs.filter(x => x.name !== 'view'),
				}
			}
			return data
		}

		await store.change_folder_view('/ws/pics', 'masonry')
		await refresh_cached_folder(
			store,
			fake.fm,
			'/ws/pics',
			{ kind: 'modify', ids: ['/ws/pics'] },
		)

		expect(fake.get_xattr('/ws/pics', 'view')).toBe('masonry')
		expect(store.folder_container.view).toBe('masonry')
	})

	test('external create refreshes opened folder children and tree', async () => {
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/external.txt')

		fake.emit_watch_event('/ws', {
			kind: 'create',
			ids: ['/ws/external.txt'],
		})

		await vi.waitFor(() => {
			expect(store.opened_folder.children.some(c => c.id === '/ws/external.txt')).toBe(true)
		})
		expect(tree_ids(store)).toContain('/ws/external.txt')
	})

	test('external create under a preview folder refreshes that cache entry', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_file('/ws/docs/b.txt')

		fake.emit_watch_event('/ws', {
			kind: 'create',
			ids: ['/ws/docs/b.txt'],
		})

		await vi.waitFor(() => {
			expect(
				store.preview_folders['/ws/docs']!.children.some(c => c.id === '/ws/docs/b.txt'),
			).toBe(true)
		})
	})

	test('external remove updates folders, tree and selection', async () => {
		const { fake, store } = await makeStore()
		store.select('/ws/note.txt')

		await fake.fm.remove('/ws/note.txt')
		fake.emit_watch_event('/ws', {
			kind: 'remove',
			ids: ['/ws/note.txt'],
		})

		await vi.waitFor(() => {
			expect(store.opened_folder.children.some(c => c.id === '/ws/note.txt')).toBe(false)
		})
		expect(tree_ids(store)).not.toContain('/ws/note.txt')
		expect(store.is_selected('/ws/note.txt')).toBe(false)
	})

	test('remove watch for a cached preview folder does not set last_error', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		expect(store.folders['/ws/docs']).toBeDefined()

		await fake.fm.remove('/ws/docs')
		fake.emit_watch_event('/ws', {
			kind: 'remove',
			ids: ['/ws/docs'],
		})

		await vi.waitFor(() => {
			expect(store.folders['/ws/docs']).toBeUndefined()
		})
		expect(store.last_error).toBeNull()
		expect(store.opened_folder.children.some(c => c.id === '/ws/docs')).toBe(false)
	})

	test('external rename updates folders, tree and selection', async () => {
		const { fake, store } = await makeStore()
		store.select('/ws/note.txt')

		await fake.fm.rename('/ws/note.txt', 'renamed.txt')
		fake.emit_watch_event('/ws', {
			kind: 'rename',
			ids: ['/ws/note.txt', '/ws/renamed.txt'],
		})

		await vi.waitFor(() => {
			expect(store.opened_folder.children.some(c => c.id === '/ws/renamed.txt')).toBe(true)
		})
		expect(tree_ids(store)).toContain('/ws/renamed.txt')
		expect(tree_ids(store)).not.toContain('/ws/note.txt')
		expect(store.is_selected('/ws/renamed.txt')).toBe(true)
		expect(store.is_selected('/ws/note.txt')).toBe(false)
	})

	test('external modify invalidates cached shape svg content', async () => {
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/shape.svg', shape_template_svg('rect'))

		// Prime the session cache with the on-disk content (as ShapeSvgPreview does).
		const first = await store.content_caches.shapes.get('/ws/shape.svg', async () =>
			prepare_svg_for_preview(await store.read_note_content('/ws/shape.svg')))
		expect(first).toContain('<rect')

		// An external editor rewrites the file (e.g. Inkscape changes the fill).
		const edited = shape_template_svg('rect').replace(/fill="[^"]*"/, 'fill="#ff0000"')
		fake.seed_file('/ws/shape.svg', edited)
		fake.emit_watch_event('/ws', { kind: 'modify', ids: ['/ws/shape.svg'] })

		// A subscriber-driven reload (as useShapeContent does) must re-read from disk.
		const reloaded = await store.content_caches.shapes.get('/ws/shape.svg', async () =>
			prepare_svg_for_preview(await store.read_note_content('/ws/shape.svg')))
		expect(reloaded).toContain('#ff0000')
	})

	test('external modify triggers a subscriber-driven note reload', async () => {
		const { fake, store } = await makeStore()

		// Mirror useNoteEditor: primed cache plus a subscriber that reloads
		// when the cache signals an external edit (undefined).
		const load = vi.fn(async () => store.read_note_content('/ws/note.txt'))
		await store.content_caches.notes.get('/ws/note.txt', load)
		store.content_caches.notes.subscribe('/ws/note.txt', (value) => {
			if (value === undefined) {
				void store.content_caches.notes.get('/ws/note.txt', load)
			}
		})

		// Another client saves the note.
		fake.seed_file('/ws/note.txt', 'edited elsewhere')
		fake.emit_watch_event('/ws', { kind: 'modify', ids: ['/ws/note.txt'] })

		await vi.waitFor(() => {
			expect(load).toHaveBeenCalledTimes(2)
		})
		expect(await store.content_caches.notes.get('/ws/note.txt', load)).toBe('edited elsewhere')
	})

	test('dispose unsubscribes from watch', async () => {
		const { fake, store } = await makeStore()
		store.dispose()

		fake.seed_file('/ws/after-dispose.txt')
		fake.emit_watch_event('/ws', {
			kind: 'create',
			ids: ['/ws/after-dispose.txt'],
		})

		await new Promise(resolve => setTimeout(resolve, 20))
		expect(store.opened_folder.children.some(c => c.id === '/ws/after-dispose.txt')).toBe(false)
	})
})

describe('createWorkspaceStore: live updates', () => {
	/**
	 * Wraps fake.fm.watch to track live subscriptions by folder; a watch of
	 * `slow_folder` waits for release(), like a realtime join in flight.
	 */
	function track_watches(fake: ReturnType<typeof createFakeFileManager>, slow_folder: string) {
		const watch = fake.fm.watch.bind(fake.fm)
		const active = new Set<string>()
		let release: (() => void) | null = null
		fake.fm.watch = async (folder_id, on_event, options) => {
			if (folder_id === slow_folder) {
				await new Promise<void>(resolve => {
					release = () => resolve()
				})
			}
			const unwatch = await watch(folder_id, on_event, options)
			active.add(folder_id)
			return () => {
				active.delete(folder_id)
				unwatch()
			}
		}
		return {
			active,
			is_waiting: () => release !== null,
			release: () => release?.(),
		}
	}

	async function make_tracked_store(slow_folder: string) {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/a')
		fake.seed_folder('/ws/b')
		const watches = track_watches(fake, slow_folder)
		const store = await createWorkspaceStore({ id: '/ws', type: 'local', name: 'ws' }, fake.fm)
		if (!store) throw new Error('createWorkspaceStore returned null')
		return { watches, store }
	}

	test('a store without live updates only lists, also after navigation', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/ws')
		fake.seed_folder('/ws/pics')
		const store = await createWorkspaceStore(
			{ id: '/ws', type: 'local', name: 'ws' },
			fake.fm,
			{ can_write: false, live: false },
		)
		if (!store) throw new Error('createWorkspaceStore returned null')

		await store.open_folder('/ws/pics')
		await store.ensure_strokes('/ws/pics')
		await store.ensure_connections('/ws/pics')

		const methods = fake.calls.map(call => call.method)
		expect(methods.filter(method => method.startsWith('watch'))).toEqual([])
		expect(methods).toContain('list_strokes')
		expect(methods).toContain('list_connections')
	})

	test('quick navigation keeps exactly one live watch', async () => {
		const { watches, store } = await make_tracked_store('/ws/a')

		const slow = store.open_folder('/ws/a')
		await vi.waitFor(() => expect(watches.is_waiting()).toBe(true))
		await store.open_folder('/ws/b')
		watches.release()
		await slow

		expect([...watches.active]).toEqual(['/ws/b'])
	})

	test('dispose during a pending watch releases it once it resolves', async () => {
		const { watches, store } = await make_tracked_store('/ws/a')

		const pending = store.open_folder('/ws/a')
		await vi.waitFor(() => expect(watches.is_waiting()).toBe(true))
		store.dispose()
		watches.release()
		await pending

		expect(watches.active.size).toBe(0)
	})

	test('a resync re-reads the cached folders of the watched subtree', async () => {
		const { fake, store } = await makeStore()
		// changed while live updates were down: no event arrives for it
		fake.seed_file('/ws/missed.txt')

		fake.emit_watch_event('/ws', { kind: 'resync', ids: ['/ws'] })

		await vi.waitFor(() => {
			expect(store.opened_folder.children.some(c => c.id === '/ws/missed.txt')).toBe(true)
		})
	})
})

describe('createWorkspaceStore: import_files progress', () => {
	test('tracks per-file progress during upload and clears it after', async () => {
		const { fake, store } = await makeStore()
		const seen: {
			name: string
			file_index: number
			total_files: number
			loaded: number
			total: number
		}[] = []

		const original = fake.fm.upload_file.bind(fake.fm)
		fake.fm.upload_file = async (folder_id, filename, data, mime, onProgress) => {
			const progress = store.import_progress
			if (!progress) throw new Error('import_progress is not set during upload')
			onProgress?.(data.size / 2, data.size)
			seen.push({
				name: progress.file_name,
				file_index: progress.file_index,
				total_files: progress.total_files,
				loaded: progress.loaded_bytes,
				total: progress.total_bytes,
			})
			return original(folder_id, filename, data, mime, onProgress)
		}

		await store.import_files('/ws', [
			new File(['aaaa'], 'one.txt'),
			new File(['bbbbbb'], 'two.txt'),
		])

		expect(seen).toEqual([
			{ name: 'one.txt', file_index: 1, total_files: 2, loaded: 2, total: 4 },
			{ name: 'two.txt', file_index: 2, total_files: 2, loaded: 3, total: 6 },
		])
		expect(store.import_progress).toBeNull()
		expect(store.opened_folder.children.map(c => c.name))
			.toEqual(expect.arrayContaining(['one.txt', 'two.txt']))
	})

	test('clears import_progress when an upload fails', async () => {
		const { fake, store } = await makeStore()
		fake.fail_once('upload_file')

		await store.import_files('/ws', [new File(['x'], 'fail.txt')])

		expect(store.import_progress).toBeNull()
		expect(store.last_error).not.toBeNull()
	})
})

describe('createWorkspaceStore: strokes', () => {
	const stroke = (id: string, z: number) => ({
		id,
		z,
		position: { x: 0, y: 0 },
		points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
		color: '#000',
		stroke_width: 2,
		width: 20,
		height: 20,
	})
	const node = (id: string, z: number) => ({ type: 'stroke' as const, ...stroke(id, z) })

	test('ensure_strokes loads ink lazily and only once', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/pics', [stroke('s1', 1)])

		expect(store.strokes_for('/ws/pics')).toEqual([])
		await store.ensure_strokes('/ws/pics')
		expect(store.strokes_for('/ws/pics')).toEqual([node('s1', 1)])

		const list_calls = fake.calls.filter(c => c.method === 'list_strokes').length
		await store.ensure_strokes('/ws/pics')
		expect(fake.calls.filter(c => c.method === 'list_strokes').length).toBe(list_calls)
	})

	test('upsert_strokes applies optimistically and persists through fm', async () => {
		const { fake, store } = await makeStore()
		await store.ensure_strokes('/ws/pics')

		await store.upsert_strokes('/ws/pics', [node('s2', 2), node('s1', 1)])

		expect(store.strokes_for('/ws/pics').map(s => s.id)).toEqual(['s1', 's2'])
		expect(await fake.fm.strokes.list_strokes('/ws/pics')).toEqual([
			stroke('s1', 1),
			stroke('s2', 2),
		])
	})

	test('delete_strokes removes from the map and storage', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/pics', [stroke('s1', 1), stroke('s2', 2)])
		await store.ensure_strokes('/ws/pics')

		await store.delete_strokes('/ws/pics', ['s1'])

		expect(store.strokes_for('/ws/pics').map(s => s.id)).toEqual(['s2'])
		expect((await fake.fm.strokes.list_strokes('/ws/pics')).map(s => s.id)).toEqual(['s2'])
	})

	test('remote watch events merge by stroke id', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/pics', [stroke('s1', 1)])
		await store.ensure_strokes('/ws/pics')

		// another client: moved s1, added s2
		fake.emit_strokes_event('/ws/pics', {
			upserted: [{ ...stroke('s1', 1), position: { x: 42, y: 7 } }, stroke('s2', 2)],
			deleted: [],
		})
		expect(store.strokes_for('/ws/pics')).toEqual([
			{ ...node('s1', 1), position: { x: 42, y: 7 } },
			node('s2', 2),
		])

		fake.emit_strokes_event('/ws/pics', { upserted: [], deleted: ['s1'] })
		expect(store.strokes_for('/ws/pics').map(s => s.id)).toEqual(['s2'])
	})

	test('failed upsert reports the error and reloads ink from storage', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/pics', [stroke('s1', 1)])
		await store.ensure_strokes('/ws/pics')

		const original = fake.fm.strokes.upsert_strokes.bind(fake.fm.strokes)
		fake.fm.strokes.upsert_strokes = async () => {
			throw new Error('injected strokes failure')
		}

		await store.upsert_strokes('/ws/pics', [node('s2', 2)])

		expect(store.last_error).not.toBeNull()
		// rolled back to the persisted state
		expect(store.strokes_for('/ws/pics')).toEqual([node('s1', 1)])

		fake.fm.strokes.upsert_strokes = original
		await store.upsert_strokes('/ws/pics', [node('s2', 2)])
		expect(store.strokes_for('/ws/pics').map(s => s.id)).toEqual(['s1', 's2'])
	})

	test('removing a folder drops its ink cache and watcher', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/docs', [stroke('s1', 1)])
		await store.ensure_strokes('/ws/docs')
		expect(store.strokes_for('/ws/docs')).toHaveLength(1)

		await store.remove('/ws/docs')

		expect(store.strokes_for('/ws/docs')).toEqual([])
		// the strokes watcher is gone: emitting into the void must not throw
		fake.emit_strokes_event('/ws/docs', { upserted: [stroke('s9', 9)], deleted: [] })
		expect(store.strokes_for('/ws/docs')).toEqual([])
	})

	test('a resync re-lists ink missed while live updates were down', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/pics', [stroke('s1', 1), stroke('s2', 2)])
		await store.ensure_strokes('/ws/pics')

		// meanwhile, elsewhere: s1 erased, s3 drawn — no events arrived
		fake.seed_strokes('/ws/pics', [stroke('s2', 2), stroke('s3', 3)])
		fake.emit_strokes_event('/ws/pics', { upserted: [], deleted: [], resync: true })

		await vi.waitFor(() => {
			expect(store.strokes_for('/ws/pics').map(s => s.id)).toEqual(['s2', 's3'])
		})
	})

	test('a stroke erased here during the resync is not brought back by it', async () => {
		const { fake, store } = await makeStore()
		fake.seed_strokes('/ws/pics', [stroke('s1', 1), stroke('s2', 2)])
		await store.ensure_strokes('/ws/pics')

		const list = fake.fm.strokes.list_strokes.bind(fake.fm.strokes)
		// like the cloud fm, whose own writes never echo back
		fake.fm.strokes.delete_strokes = async (folder_id, ids) => {
			fake.seed_strokes(folder_id, (await list(folder_id)).filter(s => !ids.includes(s.id)))
		}
		// the re-list answers with a snapshot taken before the erase lands
		const gate: { release?: () => void } = {}
		fake.fm.strokes.list_strokes = async (folder_id) => {
			const snapshot = await list(folder_id)
			await new Promise<void>(resolve => {
				gate.release = () => resolve()
			})
			return snapshot
		}

		fake.seed_strokes('/ws/pics', [stroke('s1', 1), stroke('s2', 2), stroke('s3', 3)])
		fake.emit_strokes_event('/ws/pics', { upserted: [], deleted: [], resync: true })
		await vi.waitFor(() => expect(gate.release).toBeDefined())
		await store.delete_strokes('/ws/pics', ['s2'])
		gate.release!()

		await vi.waitFor(() => {
			expect(store.strokes_for('/ws/pics').map(s => s.id)).toEqual(['s1', 's3'])
		})
	})
})

describe('createWorkspaceStore: connections', () => {
	const edge = (id: string, from: string, to: string) => ({
		id,
		from,
		to,
		is_animated: false,
	})

	test('ensure_connections loads edges lazily and only once', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])

		expect(store.connections_for('/ws')).toEqual([])
		await store.ensure_connections('/ws')
		expect(store.connections_for('/ws')).toEqual([edge('c1', '/ws/note.txt', '/ws/pics')])

		const list_calls = fake.calls.filter(c => c.method === 'list_connections').length
		await store.ensure_connections('/ws')
		expect(fake.calls.filter(c => c.method === 'list_connections').length).toBe(list_calls)
	})

	test('ensure_connections heals stale sidecar paths after an external folder move', async () => {
		const { fake, store } = await makeStore()
		fake.seed_folder('/ws/pics/docs')
		fake.seed_file('/ws/pics/docs/a.txt')
		fake.seed_file('/ws/pics/docs/b.txt')
		fake.seed_connections('/ws/pics/docs', [
			edge('c1', '/ws/docs/a.txt', '/ws/docs/b.txt'),
		])

		await store.ensure_connections('/ws/pics/docs')

		expect(store.connections_for('/ws/pics/docs')).toEqual([
			edge('c1', '/ws/pics/docs/a.txt', '/ws/pics/docs/b.txt'),
		])
	})

	test('upsert_connections applies optimistically and persists through fm', async () => {
		const { fake, store } = await makeStore()
		await store.ensure_connections('/ws')

		await store.upsert_connections('/ws', [
			{ ...edge('c1', '/ws/note.txt', '/ws/pics'), marker_end: 'arrow' as const },
		])

		expect(store.connections_for('/ws')).toEqual([
			{ ...edge('c1', '/ws/note.txt', '/ws/pics'), marker_end: 'arrow' },
		])
		expect(await fake.fm.connections.list_connections('/ws')).toEqual([
			{ ...edge('c1', '/ws/note.txt', '/ws/pics'), marker_end: 'arrow' },
		])
	})

	test('delete_connections removes from the map and storage', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [
			edge('c1', '/ws/note.txt', '/ws/pics'),
			edge('c2', '/ws/docs', '/ws/pics'),
		])
		await store.ensure_connections('/ws')

		await store.delete_connections('/ws', ['c1'])

		expect(store.connections_for('/ws').map(c => c.id)).toEqual(['c2'])
		expect((await fake.fm.connections.list_connections('/ws')).map(c => c.id)).toEqual(['c2'])
	})

	test('remote watch events merge by connection id', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		// another client: animated c1, added c2
		fake.emit_connections_event('/ws', {
			upserted: [
				{ ...edge('c1', '/ws/note.txt', '/ws/pics'), is_animated: true },
				edge('c2', '/ws/docs', '/ws/pics'),
			],
			deleted: [],
		})
		expect(store.connections_for('/ws')).toEqual([
			{ ...edge('c1', '/ws/note.txt', '/ws/pics'), is_animated: true },
			edge('c2', '/ws/docs', '/ws/pics'),
		])

		fake.emit_connections_event('/ws', { upserted: [], deleted: ['c1'] })
		expect(store.connections_for('/ws').map(c => c.id)).toEqual(['c2'])
	})

	test('failed upsert reports the error and reloads edges from storage', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		const original = fake.fm.connections.upsert_connections.bind(fake.fm.connections)
		fake.fm.connections.upsert_connections = async () => {
			throw new Error('injected connections failure')
		}

		await store.upsert_connections('/ws', [edge('c2', '/ws/docs', '/ws/pics')])

		expect(store.last_error).not.toBeNull()
		// rolled back to the persisted state
		expect(store.connections_for('/ws')).toEqual([edge('c1', '/ws/note.txt', '/ws/pics')])

		fake.fm.connections.upsert_connections = original
		await store.upsert_connections('/ws', [edge('c2', '/ws/docs', '/ws/pics')])
		expect(store.connections_for('/ws').map(c => c.id)).toEqual(['c1', 'c2'])
	})

	test('removing an entry prunes connections touching it', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [
			edge('c1', '/ws/note.txt', '/ws/pics'),
			edge('c2', '/ws/docs', '/ws/pics'),
		])
		await store.ensure_connections('/ws')

		await store.remove('/ws/note.txt')

		expect(store.connections_for('/ws').map(c => c.id)).toEqual(['c2'])
		expect((await fake.fm.connections.list_connections('/ws')).map(c => c.id)).toEqual(['c2'])
	})

	test('cross-folder move relocates the edge into the target folder', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		await store.move('/ws/note.txt', '/ws/docs', 0)

		// The edge follows the moved entry; the other endpoint still points
		// into the source folder, so it renders nowhere until it joins too.
		const relocated = edge(
			'/ws/docs/note.txt:default-/ws/pics:default',
			'/ws/docs/note.txt',
			'/ws/pics',
		)
		expect(store.connections_for('/ws')).toEqual([])
		expect(store.connections_for('/ws/docs')).toEqual([relocated])
		expect(await fake.fm.connections.list_connections('/ws')).toEqual([])
		expect(await fake.fm.connections.list_connections('/ws/docs')).toEqual([relocated])
	})

	test('moving both endpoints to the same folder keeps their connection', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		await store.move('/ws/note.txt', '/ws/docs', 0)
		await store.move('/ws/pics', '/ws/docs', 0)

		const kept = edge(
			'/ws/docs/note.txt:default-/ws/docs/pics:default',
			'/ws/docs/note.txt',
			'/ws/docs/pics',
		)
		expect(store.connections_for('/ws')).toEqual([])
		expect(store.connections_for('/ws/docs')).toEqual([kept])
		expect(await fake.fm.connections.list_connections('/ws')).toEqual([])
		expect(await fake.fm.connections.list_connections('/ws/docs')).toEqual([kept])
	})

	test('moving both endpoints in reverse order keeps their connection', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		await store.move('/ws/pics', '/ws/docs', 0)
		await store.move('/ws/note.txt', '/ws/docs', 0)

		const kept = edge(
			'/ws/docs/note.txt:default-/ws/docs/pics:default',
			'/ws/docs/note.txt',
			'/ws/docs/pics',
		)
		expect(store.connections_for('/ws/docs')).toEqual([kept])
		expect(await fake.fm.connections.list_connections('/ws/docs')).toEqual([kept])
	})

	test('duplicating connected entries clones the edge between the copies', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		await store.duplicate_entries(['/ws/note.txt', '/ws/pics'])

		const cloned = edge(
			'/ws/note (1).txt:default-/ws/pics (1):default',
			'/ws/note (1).txt',
			'/ws/pics (1)',
		)
		expect(store.connections_for('/ws')).toEqual([
			edge('c1', '/ws/note.txt', '/ws/pics'),
			cloned,
		])
		expect(await fake.fm.connections.list_connections('/ws')).toEqual([
			edge('c1', '/ws/note.txt', '/ws/pics'),
			cloned,
		])
	})

	test('copy + paste into another folder clones the edge between the pair', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		store.copy_entries(['/ws/note.txt', '/ws/pics'])
		await store.open_folder('/ws/docs')
		await store.paste()

		const cloned = edge(
			'/ws/docs/note.txt:default-/ws/docs/pics:default',
			'/ws/docs/note.txt',
			'/ws/docs/pics',
		)
		expect(store.connections_for('/ws/docs')).toEqual([cloned])
		expect(await fake.fm.connections.list_connections('/ws/docs')).toEqual([cloned])
		// the original edge stays in the source folder
		expect(store.connections_for('/ws')).toEqual([edge('c1', '/ws/note.txt', '/ws/pics')])
	})

	test('copying a single endpoint does not clone the edge', async () => {
		const { fake, store } = await makeStoreWithPreviews()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		store.copy_entries(['/ws/note.txt'])
		await store.open_folder('/ws/docs')
		await store.paste()

		expect(await fake.fm.connections.list_connections('/ws/docs')).toEqual([])
		expect(store.connections_for('/ws')).toEqual([edge('c1', '/ws/note.txt', '/ws/pics')])
	})

	test('renaming a folder rewrites connections inside it', async () => {
		// plain makeStore: seeds must land before any ensure_connections fires
		// (prefetch_preview_folders kicks off an unawaited one)
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/docs/b.txt')
		fake.seed_connections('/ws/docs', [edge('c1', '/ws/docs/a.txt', '/ws/docs/b.txt')])
		await store.open_folder('/ws/docs')
		await store.ensure_connections('/ws/docs')

		await store.rename('/ws/docs', 'papers')

		expect(store.connections_for('/ws/papers')).toEqual([
			edge('c1', '/ws/papers/a.txt', '/ws/papers/b.txt'),
		])
		expect(await fake.fm.connections.list_connections('/ws/papers')).toEqual([
			edge('c1', '/ws/papers/a.txt', '/ws/papers/b.txt'),
		])
	})

	test('moving a folder rewrites connections inside it even if they were never loaded', async () => {
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/docs/b.txt')
		fake.seed_connections('/ws/docs', [
			edge('/ws/docs/a.txt:default-/ws/docs/b.txt:default', '/ws/docs/a.txt', '/ws/docs/b.txt'),
		])

		await store.move('/ws/docs', '/ws/pics', 0)

		const kept = edge(
			'/ws/pics/docs/a.txt:default-/ws/pics/docs/b.txt:default',
			'/ws/pics/docs/a.txt',
			'/ws/pics/docs/b.txt',
		)
		expect(store.connections_for('/ws/pics/docs')).toEqual([kept])
		expect(await fake.fm.connections.list_connections('/ws/pics/docs')).toEqual([kept])
	})

	test('moving a folder with a loaded connections cache rewrites endpoints', async () => {
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/docs/b.txt')
		fake.seed_connections('/ws/docs', [edge('c1', '/ws/docs/a.txt', '/ws/docs/b.txt')])
		await store.ensure_connections('/ws/docs')

		await store.move('/ws/docs', '/ws/pics', 0)

		const kept = edge('c1', '/ws/pics/docs/a.txt', '/ws/pics/docs/b.txt')
		expect(store.connections_for('/ws/pics/docs')).toEqual([kept])
		expect(await fake.fm.connections.list_connections('/ws/pics/docs')).toEqual([kept])
	})

	test('moving a folder recovers connections after the old-path watcher wipes the cache', async () => {
		const { fake, store } = await makeStore()
		fake.seed_file('/ws/docs/b.txt')
		const original = edge(
			'/ws/docs/a.txt:default-/ws/docs/b.txt:default',
			'/ws/docs/a.txt',
			'/ws/docs/b.txt',
		)
		fake.seed_connections('/ws/docs', [original])
		await store.ensure_connections('/ws/docs')
		fake.emit_connections_event('/ws/docs', {
			upserted: [],
			deleted: [original.id],
		})
		expect(store.connections_for('/ws/docs')).toEqual([])

		await store.move('/ws/docs', '/ws/pics', 0)

		const kept = edge(
			'/ws/pics/docs/a.txt:default-/ws/pics/docs/b.txt:default',
			'/ws/pics/docs/a.txt',
			'/ws/pics/docs/b.txt',
		)
		expect(store.connections_for('/ws/pics/docs')).toEqual([kept])
		expect(await fake.fm.connections.list_connections('/ws/pics/docs')).toEqual([kept])
	})
	test('removing a folder drops its connections cache and watcher', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws/docs', [edge('c1', '/ws/docs/a.txt', '/ws/docs/a.txt')])
		await store.ensure_connections('/ws/docs')
		expect(store.connections_for('/ws/docs')).toHaveLength(1)

		await store.remove('/ws/docs')

		expect(store.connections_for('/ws/docs')).toEqual([])
		// the connections watcher is gone: emitting into the void must not throw
		fake.emit_connections_event('/ws/docs', {
			upserted: [edge('c9', '/ws/docs/a.txt', '/ws/docs/a.txt')],
			deleted: [],
		})
		expect(store.connections_for('/ws/docs')).toEqual([])
	})

	test('a resync re-lists edges missed while live updates were down', async () => {
		const { fake, store } = await makeStore()
		fake.seed_connections('/ws', [edge('c1', '/ws/note.txt', '/ws/pics')])
		await store.ensure_connections('/ws')

		// meanwhile, elsewhere: c1 removed, c2 drawn — no events arrived
		fake.seed_connections('/ws', [edge('c2', '/ws/pics', '/ws/note.txt')])
		fake.emit_connections_event('/ws', { upserted: [], deleted: [], resync: true })

		await vi.waitFor(() => {
			expect(store.connections_for('/ws').map(c => c.id)).toEqual(['c2'])
		})
	})
})

describe('createWorkspaceStore: a file saved by another app', () => {
	test('keeps the card layout an atomic save dropped, and writes it back to the file', async () => {
		const { fake, store } = await makeStore()
		fake.set_xattr('/ws/note.txt', 'position', '{"x":10,"y":20}')
		fake.set_xattr('/ws/note.txt', 'size', '{"width":300,"height":200}')
		await refresh_cached_folder(store, fake.fm, '/ws', { kind: 'modify', ids: ['/ws/note.txt'], content_changed: false })

		// Preview-style save: a new file under the same name, without xattrs
		await fake.fm.upload_file('/ws', 'note.txt', new Blob(['saved elsewhere']), 'text/plain')
		await refresh_cached_folder(store, fake.fm, '/ws', { kind: 'modify', ids: ['/ws/note.txt'] })
		await new Promise(resolve => setTimeout(resolve, 0))

		const note = store.folders['/ws']!.children.find(child => child.id === '/ws/note.txt')!
		expect(note.xattrs).toContainEqual({ name: 'size', value: '{"width":300,"height":200}' })
		expect(fake.get_xattr('/ws/note.txt', 'position')).toBe('{"x":10,"y":20}')
		expect(fake.get_xattr('/ws/note.txt', 'size')).toBe('{"width":300,"height":200}')
	})

	test('a layout-only change that removes keys is not undone', async () => {
		const { fake, store } = await makeStore()
		fake.set_xattr('/ws/note.txt', 'position', '{"x":10,"y":20}')
		await refresh_cached_folder(store, fake.fm, '/ws', { kind: 'modify', ids: ['/ws/note.txt'], content_changed: false })

		await fake.fm.remove_xattr('/ws/note.txt', 'position')
		await refresh_cached_folder(store, fake.fm, '/ws', { kind: 'modify', ids: ['/ws/note.txt'], content_changed: false })

		expect(fake.get_xattr('/ws/note.txt', 'position')).toBeNull()
	})
})

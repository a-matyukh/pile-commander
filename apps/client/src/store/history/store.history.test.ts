import { describe, expect, test, vi } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import type { Connection, StrokeNode } from '@/domain/Widget'
import { shape_template_svg } from '@/services/board/shapes'
import { createWorkspaceStore } from '../index'
import { create_history } from './history'
import type { HistoryTx } from './types'

vi.spyOn(console, 'log').mockImplementation(() => {})
vi.spyOn(console, 'error').mockImplementation(() => {})

const at = (x: number, y: number) => JSON.stringify({ x, y })

/** A real workspace store over the fake file manager, with its own history */
async function setup() {
	const fake = createFakeFileManager()
	fake.seed_folder('/ws')
	fake.seed_file('/ws/a.md', 'hello')
	fake.seed_file('/ws/b.md', '')
	fake.seed_file('/ws/Shape 1.svg', shape_template_svg('rect'))
	fake.set_xattr('/ws/a.md', 'position', at(10, 10))
	const ws = await createWorkspaceStore({ id: '/ws', type: 'local', name: 'ws' }, fake.fm)
	if (!ws) throw new Error('createWorkspaceStore returned null')
	ws.history_ref = { drive_id: 'local', root_id: '/ws' }
	const h = create_history<WorkspaceStore>({ borrow: async () => ({ store: ws, release() {} }) })
	const meta = { label: 'test', folder: { drive_id: 'local', root_id: '/ws', folder_id: '/ws' }, folder_name: 'ws' }
	const act = (fn: (tx: HistoryTx | undefined) => Promise<unknown>) => h.transact(meta, fn)
	return { fake, ws, h, act }
}

describe('undo through the workspace store', () => {
	test('a moved card goes back and forward', async () => {
		const { fake, ws, h, act } = await setup()
		await act(tx => ws.change_position('/ws/a.md', { x: 50, y: 60 }, { tx }))
		expect(fake.get_xattr('/ws/a.md', 'position')).toBe(at(50, 60))

		await h.undo()
		expect(fake.get_xattr('/ws/a.md', 'position')).toBe(at(10, 10))
		await h.redo()
		expect(fake.get_xattr('/ws/a.md', 'position')).toBe(at(50, 60))
	})

	test('a card that had no place gets none back', async () => {
		const { fake, ws, h, act } = await setup()
		await act(tx => ws.change_position('/ws/b.md', { x: 5, y: 5 }, { tx }))
		await h.undo()
		expect(fake.get_xattr('/ws/b.md', 'position')).toBeNull()
	})

	test('a move someone made since is left as it is', async () => {
		const { fake, ws, h, act } = await setup()
		await act(tx => ws.change_position('/ws/a.md', { x: 50, y: 60 }, { tx }))
		// another tab moves the same card: the store's cache still shows ours for 2 s
		fake.set_xattr('/ws/a.md', 'position', at(99, 99))
		await h.undo()
		expect(fake.get_xattr('/ws/a.md', 'position')).toBe(at(99, 99))
	})

	test('a text block resize (width mode, size, place) is one undo', async () => {
		const { fake, ws, h, act } = await setup()
		await act(async (tx) => {
			await ws.change_text_width('/ws/a.md', 'fixed', { tx })
			await ws.change_size('/ws/a.md', { width: 300, height: 80 }, { tx })
			await ws.change_position('/ws/a.md', { x: 20, y: 10 }, { tx })
		})
		expect(h.snapshot().undo).toHaveLength(1)
		await h.undo()
		expect(fake.get_xattr('/ws/a.md', 'size')).toBeNull()
		expect(fake.get_xattr('/ws/a.md', 'position')).toBe(at(10, 10))
	})

	test('a note’s text comes back as it was', async () => {
		const { fake, ws, h, act } = await setup()
		ws.content_caches.notes.set('/ws/a.md', 'bye')
		const heard: (string | undefined)[] = []
		ws.content_caches.notes.subscribe('/ws/a.md', value => heard.push(value))
		await act(tx => ws.save_note_content('/ws/a.md', 'bye', { tx, before: 'hello' }))
		await h.undo()
		expect(await fake.fm.read_text_file('/ws/a.md')).toBe('hello')
		// a note on screen reloads on a drop of its cached text, not on a set
		expect(heard).toEqual([undefined])
		await h.redo()
		expect(await fake.fm.read_text_file('/ws/a.md')).toBe('bye')
	})

	test('a shape’s color comes back: the file, not the preview the cache shows', async () => {
		const { fake, ws, h, act } = await setup()
		const before = await fake.fm.read_text_file('/ws/Shape 1.svg')
		await act(tx => ws.change_shape_fill('/ws/Shape 1.svg', '#ff0000', { tx }))
		expect(await fake.fm.read_text_file('/ws/Shape 1.svg')).not.toBe(before)
		await h.undo()
		expect(await fake.fm.read_text_file('/ws/Shape 1.svg')).toBe(before)
	})

	test('an arrow drawn on the canvas goes away and comes back', async () => {
		const { fake, ws, h, act } = await setup()
		await ws.ensure_connections('/ws')
		const edge: Connection = { id: 'e1', from: '/ws/a.md', to: '/ws/b.md', is_animated: false }
		await act(tx => ws.upsert_connections('/ws', [edge], { tx }))
		await h.undo()
		expect(await fake.fm.connections.list_connections('/ws')).toEqual([])
		await h.redo()
		expect((await fake.fm.connections.list_connections('/ws')).map(c => c.id)).toEqual(['e1'])
	})

	test('an erased stroke comes back', async () => {
		const { fake, ws, h, act } = await setup()
		await ws.ensure_strokes('/ws')
		const stroke: StrokeNode = {
			id: 's1',
			type: 'stroke',
			z: 1,
			position: { x: 0, y: 0 },
			points: [{ x: 0, y: 0 }, { x: 10.5, y: 3.25 }],
			color: '#000',
			stroke_width: 2,
			width: 11,
			height: 4,
		}
		await ws.upsert_strokes('/ws', [stroke])
		await act(tx => ws.delete_strokes('/ws', ['s1'], { tx }))
		expect(await fake.fm.strokes.list_strokes('/ws')).toEqual([])
		await h.undo()
		expect((await fake.fm.strokes.list_strokes('/ws')).map(s => s.id)).toEqual(['s1'])
	})

	test('the order of layers comes back', async () => {
		const { ws, h, act } = await setup()
		const order = () => ws.folder_container.children.map(child => child.id)
		const start = order()
		const reversed = [...start].reverse()
		await act(tx => ws.reorder_children('/ws', reversed, { tx }))
		expect(order()).toEqual(reversed)
		await h.undo()
		expect(order()).toEqual(start)
	})

	test('a folder’s cover color goes back to none', async () => {
		const { fake, ws, h, act } = await setup()
		await act(tx => ws.change_folder_cover('/ws', '#ff0000', { tx }))
		expect(fake.get_xattr('/ws', 'cover')).toBe('#ff0000')
		await h.undo()
		expect(fake.get_xattr('/ws', 'cover')).toBeNull()
		await h.redo()
		expect(fake.get_xattr('/ws', 'cover')).toBe('#ff0000')
	})

	test('a store method without tx records nothing', async () => {
		const { ws, h } = await setup()
		await ws.change_position('/ws/a.md', { x: 1, y: 2 })
		expect(h.can_undo).toBe(false)
	})
})

describe('undo of file operations within one store', () => {
	test('a new note goes away for good and comes back with its place', async () => {
		const { fake, ws, h, act } = await setup()
		const id = await act(tx => ws.create_note('/ws', { x: 7, y: 8 }, { tx })) as string
		expect(fake.has(id)).toBe(true)

		await h.undo()
		expect(fake.has(id)).toBe(false)
		expect(ws.folders['/ws']?.children.some(child => child.id === id)).toBe(false)

		await h.redo()
		expect(fake.has(id)).toBe(true)
		expect(fake.get_xattr(id, 'position')).toBe(at(7, 8))
	})

	test('a new note someone wrote into is left where it is', async () => {
		const { fake, ws, h, act } = await setup()
		const id = await act(tx => ws.create_note('/ws', undefined, { tx })) as string
		await fake.fm.save_text_file(id, 'their text')
		await h.undo()
		expect(fake.has(id)).toBe(true)
		expect(await fake.fm.read_text_file(id)).toBe('their text')
	})

	test('a renamed file gets its name back, and the new one again on redo', async () => {
		const { fake, ws, h, act } = await setup()
		const renamed = await act(tx => ws.rename('/ws/b.md', 'c.md', { tx }))
		expect(renamed).toBe('/ws/c.md')
		await h.undo()
		expect(fake.has('/ws/b.md')).toBe(true)
		expect(fake.has('/ws/c.md')).toBe(false)
		await h.redo()
		expect(fake.has('/ws/c.md')).toBe(true)
	})

	test('a file moved into a folder comes back out, with its place', async () => {
		const { fake, ws, h, act } = await setup()
		// a file of its own: pending overlays of other tests' writes are module-wide for 2 s
		fake.seed_folder('/ws/box')
		fake.seed_file('/ws/m.md', 'moving')
		fake.set_xattr('/ws/m.md', 'position', at(20, 20))
		await ws.reload_folder_cache('/ws')
		await act(async (tx) => {
			const moved = await ws.move('/ws/m.md', '/ws/box', 0, '/ws', undefined, { tx })
			expect(moved).toBe('/ws/box/m.md')
			await ws.show_folder_children('/ws/box')
			await ws.change_position('/ws/box/m.md', { x: 1, y: 1 }, { tx })
		})
		await h.undo()
		expect(fake.has('/ws/m.md')).toBe(true)
		expect(fake.has('/ws/box/m.md')).toBe(false)
		expect(fake.get_xattr('/ws/m.md', 'position')).toBe(at(20, 20))
	})

	test('a duplicate goes away; the original stays', async () => {
		const { fake, ws, h, act } = await setup()
		const copies = await act(tx => ws.duplicate_entries(['/ws/a.md'], { tx })) as string[]
		expect(copies).toHaveLength(1)
		await h.undo()
		expect(fake.has(copies[0]!)).toBe(false)
		expect(fake.has('/ws/a.md')).toBe(true)
	})

	test('a new folder with entries moved into it is one undo: they come back and the folder goes', async () => {
		const { fake, ws, h, act } = await setup()
		await act(async (tx) => {
			const folder = await ws.create_folder('/ws', { x: 0, y: 0 }, { tx })
			await ws.move('/ws/a.md', folder, 0, '/ws', undefined, { tx })
			await ws.move('/ws/b.md', folder, 1, '/ws', undefined, { tx })
		})
		expect(h.snapshot().undo).toHaveLength(1)
		await h.undo()
		expect(fake.has('/ws/a.md')).toBe(true)
		expect(fake.has('/ws/b.md')).toBe(true)
		expect(fake.has('/ws/New folder 1')).toBe(false)
	})

	test('an added file goes away and is uploaded again from the same File on redo', async () => {
		const { fake, ws, h, act } = await setup()
		const file = new File(['png bytes'], 'photo.png', { type: 'image/png' })
		await act(tx => ws.import_files('/ws', [file], undefined, { tx }))
		expect(fake.has('/ws/photo.png')).toBe(true)
		await h.undo()
		expect(fake.has('/ws/photo.png')).toBe(false)
		await h.redo()
		expect(fake.has('/ws/photo.png')).toBe(true)
	})

	test('a text block made and left empty leaves no undo and no file', async () => {
		const { fake, ws } = await setup()
		const { history } = await import('./index')
		history.clear()
		const id = await ws.create_text('/ws')
		expect(history.can_undo).toBe(true)
		expect(history.drop_created(ws.history_ref, id)).toBe(true)
		expect(await ws.history_remove_created(id, { text: '' })).toBe('removed')
		expect(history.can_undo).toBe(false)
		expect(fake.has(id)).toBe(false)
	})
})

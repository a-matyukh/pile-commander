import { afterEach, describe, expect, test, vi } from 'vitest'
import { createFakeFileManager, type FakeFileManager } from '@pile-commander/file-manager'
import type { WorkspaceStore } from '@/domain/Store'
import { createWorkspaceStore } from '../createWorkspaceStore'
import { entry_clipboard } from '../entryClipboard'
import { transfer_entries } from './crossStoreTransfer'

async function makeStore(
	fake: FakeFileManager,
	item: { id: string; type: 'local' | 'cloud'; name: string },
	root: string,
): Promise<WorkspaceStore> {
	const store = await createWorkspaceStore(item, fake.fm, { root_folder_id: root })
	if (!store) throw new Error('createWorkspaceStore returned null')
	return store
}

/** Two stores over separate file systems: the desktop board → workspace case. */
async function makeCloudPair() {
	const source_fake = createFakeFileManager()
	source_fake.seed_folder('/desktop-1')
	const target_fake = createFakeFileManager()
	target_fake.seed_folder('/')

	const source = await makeStore(
		source_fake,
		{ id: 'system-ws-id', type: 'cloud', name: 'Desktop' },
		'/desktop-1',
	)
	const target = await makeStore(
		target_fake,
		{ id: 'child-ws-id', type: 'cloud', name: 'Project' },
		'/',
	)
	return { source_fake, target_fake, source, target }
}

afterEach(() => {
	entry_clipboard.clear()
})

describe('crossStoreTransfer: generic path (cloud, different workspaces)', () => {
	test('copies a file with content and xattrs', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/note.txt', 'hello transfer')
		source_fake.set_xattr('/desktop-1/note.txt', 'position', JSON.stringify({ x: 10, y: 20 }))
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/note.txt'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual(['/note.txt'])
		expect(await target_fake.fm.read_text_file('/note.txt')).toBe('hello transfer')
		expect(target_fake.get_xattr('/note.txt', 'position')).toBe(JSON.stringify({ x: 10, y: 20 }))
		// copy keeps the source
		expect(source_fake.has('/desktop-1/note.txt')).toBe(true)
		// target store cache + import progress settled
		expect(target.opened_folder.children.some(c => c.id === '/note.txt')).toBe(true)
		expect(target.import_progress).toBeNull()
	})

	test('refuses a preview a public-board visitor was served instead of the file', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/photo.png', 'png-bytes')
		await source.reload_folder_cache('/desktop-1')
		// the cloud FM hands a non-member the thumb, not the original
		const get_media_src = source_fake.fm.get_media_src.bind(source_fake.fm)
		source_fake.fm.get_media_src = async (id, options) => ({
			...(await get_media_src(id, options)),
			variant: 'thumb',
		})
		const error = vi.spyOn(console, 'error').mockImplementation(() => {})

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/photo.png'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual([])
		expect(target_fake.has('/photo.png')).toBe(false)
		expect(target.last_error).toContain('only a preview is available')
		expect(source_fake.has('/desktop-1/photo.png')).toBe(true)
		error.mockRestore()
	})

	test('uploads text files with a text mime so they land in text storage', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/Note.md', '# hello')
		source_fake.seed_file('/desktop-1/photo.png', 'png-bytes')
		await source.reload_folder_cache('/desktop-1')

		await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/Note.md', '/desktop-1/photo.png'],
			target_folder_id: '/',
			mode: 'copy',
		})

		// regression: a media-only mime table reported octet-stream for .md,
		// so the upload went to blob storage and read_text_file failed
		const uploads = target_fake.calls.filter(c => c.method === 'upload_file')
		expect(uploads).toEqual([
			{ method: 'upload_file', args: ['/', 'Note.md', 7, 'text/markdown'] },
			{ method: 'upload_file', args: ['/', 'photo.png', 9, 'image/png'] },
		])
	})

	test('copies a folder recursively', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_folder('/desktop-1/docs')
		source_fake.seed_file('/desktop-1/docs/a.txt', 'a')
		source_fake.seed_folder('/desktop-1/docs/sub')
		source_fake.seed_file('/desktop-1/docs/sub/b.txt', 'b')
		source_fake.set_xattr('/desktop-1/docs', 'view', 'board')
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/docs'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual(['/docs'])
		expect(await target_fake.fm.read_text_file('/docs/a.txt')).toBe('a')
		expect(await target_fake.fm.read_text_file('/docs/sub/b.txt')).toBe('b')
		expect(target_fake.get_xattr('/docs', 'view')).toBe('board')
	})

	test('copies folder ink with fresh stroke ids', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_folder('/desktop-1/board')
		source_fake.seed_strokes('/desktop-1/board', [
			{
				id: 'stroke-1',
				z: 1,
				position: { x: 5, y: 6 },
				points: [{ x: 0, y: 0 }, { x: 10, y: 4 }],
				color: '#f00',
				stroke_width: 3,
				width: 30,
				height: 24,
			},
			{
				id: 'stroke-2',
				z: 2,
				position: { x: 40, y: 40 },
				points: [{ x: 0, y: 0 }],
				color: '#0f0',
				stroke_width: 2,
				width: 12,
				height: 12,
			},
		])
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/board'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual(['/board'])
		const copied = await target_fake.fm.strokes.list_strokes('/board')
		expect(copied).toHaveLength(2)
		expect(copied.map(s => s.z)).toEqual([1, 2])
		expect(copied[0]).toMatchObject({ position: { x: 5, y: 6 }, color: '#f00' })
		// stroke ids are the table's global PK — copies must not reuse them
		expect(copied.map(s => s.id)).not.toContain('stroke-1')
		expect(copied.map(s => s.id)).not.toContain('stroke-2')
		// source untouched
		expect(await source_fake.fm.strokes.list_strokes('/desktop-1/board')).toHaveLength(2)
	})

	test('copies folder connections with remapped endpoints and recomputed ids', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_folder('/desktop-1/board')
		source_fake.seed_file('/desktop-1/board/a.txt', 'a')
		source_fake.seed_file('/desktop-1/board/b.txt', 'b')
		source_fake.seed_file('/desktop-1/outside.txt', 'out')
		source_fake.seed_connections('/desktop-1/board', [
			{
				id: '/desktop-1/board/a.txt:default-/desktop-1/board/b.txt:default',
				from: '/desktop-1/board/a.txt',
				to: '/desktop-1/board/b.txt',
				marker_end: 'arrow',
				is_animated: true,
			},
			{
				// an endpoint outside the copied subtree — dropped, mirroring
				// the copy_entry RPC's inner joins
				id: '/desktop-1/board/a.txt:default-/desktop-1/outside.txt:default',
				from: '/desktop-1/board/a.txt',
				to: '/desktop-1/outside.txt',
				is_animated: false,
			},
		])
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/board'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual(['/board'])
		expect(await target_fake.fm.connections.list_connections('/board')).toEqual([
			{
				id: '/board/a.txt:default-/board/b.txt:default',
				from: '/board/a.txt',
				to: '/board/b.txt',
				marker_end: 'arrow',
				is_animated: true,
			},
		])
		// source untouched
		expect(await source_fake.fm.connections.list_connections('/desktop-1/board')).toHaveLength(2)
	})

	test('copying connected entries clones the edges between them', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/a.txt', 'a')
		source_fake.seed_file('/desktop-1/b.txt', 'b')
		source_fake.seed_file('/desktop-1/c.txt', 'c')
		source_fake.seed_connections('/desktop-1', [
			{
				id: 'e1',
				from: '/desktop-1/a.txt',
				to: '/desktop-1/b.txt',
				marker_end: 'arrow',
				is_animated: true,
			},
			{
				// c stays behind — this edge must not be cloned
				id: 'e2',
				from: '/desktop-1/a.txt',
				to: '/desktop-1/c.txt',
				is_animated: false,
			},
		])
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/a.txt', '/desktop-1/b.txt'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual(['/a.txt', '/b.txt'])
		expect(await target_fake.fm.connections.list_connections('/')).toEqual([
			{
				id: '/a.txt:default-/b.txt:default',
				from: '/a.txt',
				to: '/b.txt',
				marker_end: 'arrow',
				is_animated: true,
			},
		])
		// source untouched
		expect(await source_fake.fm.connections.list_connections('/desktop-1')).toHaveLength(2)
	})

	test('moving connected entries relocates the edge into the target workspace', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/a.txt', 'a')
		source_fake.seed_file('/desktop-1/b.txt', 'b')
		source_fake.seed_connections('/desktop-1', [
			{
				id: 'e1',
				from: '/desktop-1/a.txt',
				to: '/desktop-1/b.txt',
				is_animated: false,
			},
		])
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/a.txt', '/desktop-1/b.txt'],
			target_folder_id: '/',
			mode: 'move',
		})

		expect(created).toEqual(['/a.txt', '/b.txt'])
		expect(await target_fake.fm.connections.list_connections('/')).toEqual([
			{
				id: '/a.txt:default-/b.txt:default',
				from: '/a.txt',
				to: '/b.txt',
				is_animated: false,
			},
		])
		expect(await source_fake.fm.connections.list_connections('/desktop-1')).toEqual([])
	})

	test('moving a single endpoint relocates the edge with a dangling end', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/a.txt', 'a')
		source_fake.seed_file('/desktop-1/b.txt', 'b')
		source_fake.seed_connections('/desktop-1', [
			{
				id: 'e1',
				from: '/desktop-1/a.txt',
				to: '/desktop-1/b.txt',
				is_animated: false,
			},
		])
		await source.reload_folder_cache('/desktop-1')

		await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/a.txt'],
			target_folder_id: '/',
			mode: 'move',
		})

		// the edge follows the moved entry and waits for the other endpoint:
		// it renders nowhere until b.txt joins the target folder
		expect(await target_fake.fm.connections.list_connections('/')).toEqual([
			{
				id: '/a.txt:default-/desktop-1/b.txt:default',
				from: '/a.txt',
				to: '/desktop-1/b.txt',
				is_animated: false,
			},
		])
		expect(await source_fake.fm.connections.list_connections('/desktop-1')).toEqual([])
	})

	test('move removes the source and updates the source store cache', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/pic.png', 'bytes')
		await source.reload_folder_cache('/desktop-1')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/pic.png'],
			target_folder_id: '/',
			mode: 'move',
		})

		expect(created).toEqual(['/pic.png'])
		expect(source_fake.has('/desktop-1/pic.png')).toBe(false)
		expect(target_fake.has('/pic.png')).toBe(true)
		expect(source.opened_folder.children.some(c => c.id === '/desktop-1/pic.png')).toBe(false)
	})

	test('resolves name conflicts in the target folder', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/note.txt', 'new')
		target_fake.seed_file('/note.txt', 'old')
		await source.reload_folder_cache('/desktop-1')
		await target.reload_folder_cache('/')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/note.txt'],
			target_folder_id: '/',
			mode: 'copy',
		})

		expect(created).toEqual(['/note (1).txt'])
		expect(await target_fake.fm.read_text_file('/note.txt')).toBe('old')
		expect(await target_fake.fm.read_text_file('/note (1).txt')).toBe('new')
	})

	test('loads the target folder when it was not cached yet', async () => {
		const source_fake = createFakeFileManager()
		source_fake.seed_folder('/desktop-1')
		source_fake.seed_file('/desktop-1/a.txt', 'a')
		// /nested exists on disk but below the root's cached children horizon:
		// seed it before store creation so the tree knows the node, but the
		// store never loaded its children
		const target_fake = createFakeFileManager()
		target_fake.seed_folder('/')
		target_fake.seed_folder('/nested')

		const source = await makeStore(source_fake, { id: 'system-ws-id', type: 'cloud', name: 'Desktop' }, '/desktop-1')
		const target = await makeStore(target_fake, { id: 'child-ws-id', type: 'cloud', name: 'Project' }, '/')
		await source.reload_folder_cache('/desktop-1')

		expect(target.folders['/nested']).toBeUndefined()

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desktop-1/a.txt'],
			target_folder_id: '/nested',
			mode: 'copy',
		})

		expect(created).toEqual(['/nested/a.txt'])
		expect(target.folders['/nested']?.children.some(c => c.id === '/nested/a.txt')).toBe(true)
	})
})

describe('crossStoreTransfer: direct path (same workspace / local pair)', () => {
	test('same workspace in two stores copies via copy_entry, without reading content', async () => {
		// one fm behind both stores: two windows of the same workspace
		const fake = createFakeFileManager()
		fake.seed_folder('/')
		fake.seed_folder('/docs')
		fake.seed_file('/note.txt', 'shared')
		const source = await makeStore(fake, { id: 'ws-id', type: 'cloud', name: 'W' }, '/')
		const target = await makeStore(fake, { id: 'ws-id', type: 'cloud', name: 'W' }, '/docs')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/note.txt'],
			target_folder_id: '/docs',
			mode: 'copy',
		})

		expect(created).toEqual(['/docs/note.txt'])
		expect(fake.calls.some(c => c.method === 'copy_entry')).toBe(true)
		expect(fake.calls.some(c => c.method === 'get_media_src')).toBe(false)
	})

	test('local move renames through the target fm', async () => {
		const source_fake = createFakeFileManager()
		source_fake.seed_folder('/desk')
		source_fake.seed_file('/desk/a.txt', 'a')
		const target_fake = createFakeFileManager()
		target_fake.seed_folder('/ws')

		// a shared fake models one filesystem; here each store has its own fm
		// instance over the same paths (desktop board + window)
		const shared = createFakeFileManager()
		shared.seed_folder('/desk')
		shared.seed_folder('/ws')
		shared.seed_file('/desk/a.txt', 'a')
		const source = await makeStore(shared, { id: '/desk', type: 'local', name: 'Desk' }, '/desk')
		const target = await makeStore(shared, { id: '/ws', type: 'local', name: 'W' }, '/ws')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desk/a.txt'],
			target_folder_id: '/ws',
			mode: 'move',
		})

		expect(created).toEqual(['/ws/a.txt'])
		expect(shared.has('/desk/a.txt')).toBe(false)
		expect(shared.has('/ws/a.txt')).toBe(true)
		expect(shared.calls.some(c => c.method === 'move')).toBe(true)
		expect(source.opened_folder.children.some(c => c.id === '/desk/a.txt')).toBe(false)
	})

	test('skips copying a folder into its own subtree', async () => {
		const shared = createFakeFileManager()
		shared.seed_folder('/desk')
		shared.seed_folder('/desk/docs')
		const source = await makeStore(shared, { id: '/desk', type: 'local', name: 'Desk' }, '/desk')
		const target = await makeStore(shared, { id: '/desk/docs', type: 'local', name: 'Docs' }, '/desk/docs')

		const created = await transfer_entries({
			source_store: source,
			target_store: target,
			entry_ids: ['/desk/docs'],
			target_folder_id: '/desk/docs',
			mode: 'copy',
		})

		expect(created).toEqual([])
		expect(shared.calls.some(c => c.method === 'copy_entry')).toBe(false)
	})
})

describe('cross-store paste via the global clipboard', () => {
	test('cut on the desktop board + paste in a workspace window moves the entry', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/cut-me.txt', 'cut content')
		await source.reload_folder_cache('/desktop-1')

		source.cut_entries(['/desktop-1/cut-me.txt'])
		expect(source.is_cut('/desktop-1/cut-me.txt')).toBe(true)
		// is_cut is store-scoped: the target must not dim a colliding id
		expect(target.is_cut('/desktop-1/cut-me.txt')).toBe(false)

		await target.paste()

		expect(source_fake.has('/desktop-1/cut-me.txt')).toBe(false)
		expect(await target_fake.fm.read_text_file('/cut-me.txt')).toBe('cut content')
		expect(entry_clipboard.current).toBeNull()
		expect(target.opened_folder.children.some(c => c.id === '/cut-me.txt')).toBe(true)
	})

	test('copy + paste across stores keeps the source', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		source_fake.seed_file('/desktop-1/keep.txt', 'stay')
		await source.reload_folder_cache('/desktop-1')

		source.copy_entries(['/desktop-1/keep.txt'])
		await target.paste()

		expect(source_fake.has('/desktop-1/keep.txt')).toBe(true)
		expect(target_fake.has('/keep.txt')).toBe(true)
		expect(entry_clipboard.current).toBeNull()
	})

	test('cut + paste is a no-op when the other store shows the source folder', async () => {
		const shared = createFakeFileManager()
		shared.seed_folder('/desk')
		shared.seed_file('/desk/a.txt', 'a')
		const source = await makeStore(shared, { id: '/desk', type: 'local', name: 'Desk' }, '/desk')
		// a second store rooted at the very same folder (window on the same path)
		const target = await makeStore(shared, { id: '/desk', type: 'local', name: 'Desk 2' }, '/desk')

		source.cut_entries(['/desk/a.txt'])
		await target.paste()

		expect(shared.has('/desk/a.txt')).toBe(true)
		expect(shared.calls.some(c => c.method === 'move' || c.method === 'copy_entry')).toBe(false)
		expect(entry_clipboard.current?.entry_ids).toEqual(['/desk/a.txt'])
	})

	test('reverse direction: cut in a workspace window + paste onto the desktop board', async () => {
		// source is the workspace window store, target is the board store
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		target_fake.seed_file('/win-file.txt', 'from window')
		await target.reload_folder_cache('/')

		target.cut_entries(['/win-file.txt'])
		await source.paste()

		expect(target_fake.has('/win-file.txt')).toBe(false)
		expect(await source_fake.fm.read_text_file('/desktop-1/win-file.txt')).toBe('from window')
		expect(source.opened_folder.children.some(c => c.id === '/desktop-1/win-file.txt')).toBe(true)
		expect(entry_clipboard.current).toBeNull()
	})

	test('reverse direction: copy a folder from a window onto the board recursively', async () => {
		const { source_fake, target_fake, source, target } = await makeCloudPair()
		target_fake.seed_folder('/proj')
		target_fake.seed_file('/proj/a.txt', 'a')
		await target.reload_folder_cache('/')

		target.copy_entries(['/proj'])
		await source.paste()

		expect(target_fake.has('/proj')).toBe(true)
		expect(await source_fake.fm.read_text_file('/desktop-1/proj/a.txt')).toBe('a')
	})
})

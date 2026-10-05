import { describe, expect, it, vi } from 'vitest'
import { createFakeFileManager, type FakeFileManager } from '@pile-commander/file-manager'
import {
	createDesktopBoardFileManager,
	type DesktopBoardDeps,
} from './desktopBoardFileManager'
import type { WorkspaceTile } from './desktopBoards'

const BOARD = '/desktop-d1'

function make_tile(
	workspace_id: string,
	name: string,
	xattrs: Record<string, string> = {},
): WorkspaceTile {
	return { workspace_id, name, xattrs }
}

function make_setup(tiles: WorkspaceTile[] = []) {
	const inner = createFakeFileManager()
	inner.seed_folder('/')
	inner.seed_folder(BOARD)

	const child_fms = new Map<string, FakeFileManager>()
	const child_fake = (workspace_id: string): FakeFileManager => {
		let child = child_fms.get(workspace_id)
		if (!child) {
			child = createFakeFileManager()
			child.seed_folder('/')
			child_fms.set(workspace_id, child)
		}
		return child
	}
	const deps: DesktopBoardDeps = {
		tiles: () => tiles,
		workspace_fm: (workspace_id: string) => child_fake(workspace_id).fm,
		create_workspace: vi.fn(async (name: string) => ({ workspace_id: `ws-${name}` })),
		rename_workspace: vi.fn(async () => {}),
		remove_workspace: vi.fn(async () => {}),
		set_workspace_xattr: vi.fn(async () => {}),
	}
	const fm = createDesktopBoardFileManager(inner.fm, BOARD, deps)
	return { inner, fm, deps, child_fake }
}

describe('desktopBoardFileManager', () => {
	it('merges tiles into the board root listing with their xattrs', async () => {
		const { inner, fm } = make_setup([make_tile('ws-1', 'Research', { position: '{"x":1,"y":2}' })])
		inner.seed_file(`${BOARD}/notes.txt`, 'hello')

		const folder = await fm.folder_with_children_xattrs(BOARD)

		expect(folder.children).toEqual([
			{ id: `${BOARD}/notes.txt`, name: 'notes.txt', type: 'file', xattrs: [] },
			{
				id: `${BOARD}/ws-1`,
				name: 'Research',
				type: 'folder',
				xattrs: [{ name: 'position', value: '{"x":1,"y":2}' }],
			},
		])
	})

	it('reads a tile root as the child workspace root, remapping ids', async () => {
		const setup = make_setup([make_tile('ws-1', 'Research')])
		const child = setup.child_fake('ws-1')
		child.seed_file('/paper.pdf', 'pdf')
		child.seed_folder('/refs')

		const folder = await setup.fm.folder_with_children_xattrs(`${BOARD}/ws-1`)

		expect(folder.id).toBe(`${BOARD}/ws-1`)
		expect(folder.name).toBe('Research')
		expect(folder.children.map(c => c.id).sort()).toEqual([
			`${BOARD}/ws-1/paper.pdf`,
			`${BOARD}/ws-1/refs`,
		])
	})

	it('reads content inside a tile through the child workspace fm', async () => {
		const setup = make_setup([make_tile('ws-1', 'Research')])
		setup.child_fake('ws-1').seed_file('/drafts/a.txt', 'deep content')

		await expect(setup.fm.read_text_file(`${BOARD}/ws-1/drafts/a.txt`))
			.resolves.toBe('deep content')
	})

	it('creates a workspace for "New folder" at the board root', async () => {
		const { fm, deps, inner } = make_setup()

		const child = await fm.create_folder(BOARD, 'Untitled folder')

		expect(deps.create_workspace).toHaveBeenCalledWith('Untitled folder')
		expect(child).toEqual({
			id: `${BOARD}/ws-Untitled folder`,
			type: 'folder',
			name: 'Untitled folder',
		})
		// no entry folder leaked into the system workspace
		expect(inner.has(`${BOARD}/Untitled folder`)).toBe(false)
	})

	it('creates entry folders inside a tile via the child workspace fm', async () => {
		const { fm, child_fake } = make_setup([make_tile('ws-1', 'Research')])

		const child = await fm.create_folder(`${BOARD}/ws-1`, 'refs')

		expect(child).toEqual({ id: `${BOARD}/ws-1/refs`, type: 'folder', name: 'refs' })
		expect(child_fake('ws-1').has('/refs')).toBe(true)
	})

	it('routes tile xattrs to the workspace row, entry xattrs to the inner fm', async () => {
		const { inner, fm, deps } = make_setup([make_tile('ws-1', 'Research')])
		inner.seed_file(`${BOARD}/notes.txt`)

		await fm.set_xattr(`${BOARD}/ws-1`, 'position', '{"x":3,"y":4}')
		await fm.set_xattr(`${BOARD}/notes.txt`, 'position', '{"x":5,"y":6}')

		expect(deps.set_workspace_xattr).toHaveBeenCalledWith('ws-1', 'position', '{"x":3,"y":4}')
		expect(inner.get_xattr(`${BOARD}/notes.txt`, 'position')).toBe('{"x":5,"y":6}')
	})

	it('reads tile xattrs from the tiles list', async () => {
		const { fm } = make_setup([make_tile('ws-1', 'Research', { size: '{"w":1}' })])

		await expect(fm.get_xattr(`${BOARD}/ws-1`, 'size')).resolves.toBe('{"w":1}')
		await expect(fm.get_xattr(`${BOARD}/ws-1`, 'missing')).resolves.toBeNull()
		await expect(fm.list_xattrs(`${BOARD}/ws-1`)).resolves.toEqual([
			{ name: 'size', value: '{"w":1}' },
		])
	})

	it('renames a tile via the workspace row, keeping the stable id', async () => {
		const { fm, deps } = make_setup([make_tile('ws-1', 'Research')])

		const patch = await fm.rename(`${BOARD}/ws-1`, 'Papers')

		expect(deps.rename_workspace).toHaveBeenCalledWith('ws-1', 'Papers')
		expect(patch).toEqual({ id: `${BOARD}/ws-1`, name: 'Papers' })
	})

	it('renames inside a tile via the child fm and remaps the new id', async () => {
		const setup = make_setup([make_tile('ws-1', 'Research')])
		setup.child_fake('ws-1').seed_file('/a.txt', 'a')

		const patch = await setup.fm.rename(`${BOARD}/ws-1/a.txt`, 'b.txt')

		expect(patch).toEqual({ id: `${BOARD}/ws-1/b.txt`, name: 'b.txt' })
	})

	it('removes a tile by deleting the workspace row; files go to the inner fm', async () => {
		const { inner, fm, deps } = make_setup([make_tile('ws-1', 'Research')])
		inner.seed_file(`${BOARD}/notes.txt`)

		await fm.remove(`${BOARD}/ws-1`)
		await fm.remove(`${BOARD}/notes.txt`)

		expect(deps.remove_workspace).toHaveBeenCalledWith('ws-1')
		expect(inner.has(`${BOARD}/notes.txt`)).toBe(false)
	})

	it('refuses to move or copy the tile itself and entries across workspaces', async () => {
		const { inner, fm } = make_setup([make_tile('ws-1', 'Research'), make_tile('ws-2', 'Other')])
		inner.seed_file(`${BOARD}/notes.txt`)
		inner.seed_folder(`${BOARD}/sub`)

		await expect(fm.move(`${BOARD}/ws-1`, BOARD)).rejects.toThrow(/cannot be moved/)
		await expect(fm.move(`${BOARD}/notes.txt`, `${BOARD}/ws-1`)).rejects.toThrow(/not supported/)
		await expect(fm.copy_entry(`${BOARD}/ws-1`, BOARD)).rejects.toThrow(/cannot be copied/)
		// regular in-workspace moves still work
		await expect(fm.move(`${BOARD}/notes.txt`, `${BOARD}/sub`)).resolves.toEqual({
			id: `${BOARD}/sub/notes.txt`,
			name: 'notes.txt',
		})
	})

	it('moves entries inside the same tile through the child fm', async () => {
		const setup = make_setup([make_tile('ws-1', 'Research')])
		const child = setup.child_fake('ws-1')
		child.seed_file('/a.txt', 'a')
		child.seed_folder('/refs')

		const patch = await setup.fm.move(`${BOARD}/ws-1/a.txt`, `${BOARD}/ws-1/refs`)

		expect(patch).toEqual({ id: `${BOARD}/ws-1/refs/a.txt`, name: 'a.txt' })
	})

	it('shadows a board entry whose name equals a tile workspace id', async () => {
		const { inner, fm, deps } = make_setup([make_tile('ws-1', 'Research')])
		// a real file with the same name as the tile id — pathological
		inner.seed_file(`${BOARD}/ws-1`, 'collision')

		await fm.set_xattr(`${BOARD}/ws-1`, 'position', '{}')

		expect(deps.set_workspace_xattr).toHaveBeenCalledWith('ws-1', 'position', '{}')
		expect(inner.get_xattr(`${BOARD}/ws-1`, 'position')).toBeNull()
	})

	it('routes bulk xattrs per destination and maps missing ids back to desktop paths', async () => {
		const setup = make_setup([make_tile('ws-1', 'Research')])
		setup.inner.seed_file(`${BOARD}/notes.txt`)
		setup.child_fake('ws-1').seed_file('/a.txt', 'a')

		const result = await setup.fm.set_xattrs([
			{ id: `${BOARD}/notes.txt`, xattrs: { position: '{"x":1,"y":1}' } },
			{ id: `${BOARD}/ws-1`, xattrs: { position: '{"x":2,"y":2}' } },
			{ id: `${BOARD}/ws-1/a.txt`, xattrs: { order: '0' } },
			{ id: `${BOARD}/ws-1/gone.txt`, xattrs: { order: '1' } },
		])

		expect(result.missing).toEqual([`${BOARD}/ws-1/gone.txt`])
		expect(setup.inner.get_xattr(`${BOARD}/notes.txt`, 'position')).toBe('{"x":1,"y":1}')
		expect(setup.deps.set_workspace_xattr).toHaveBeenCalledWith('ws-1', 'position', '{"x":2,"y":2}')
		expect(setup.child_fake('ws-1').get_xattr('/a.txt', 'order')).toBe('0')
	})

	it('reads entry sizes through the owning file manager', async () => {
		const setup = make_setup([make_tile('ws-1', 'Research')])
		setup.inner.seed_file(`${BOARD}/notes.txt`, 'hello')
		setup.child_fake('ws-1').seed_file('/a.txt', 'abc')

		await expect(setup.fm.entry_size(`${BOARD}/notes.txt`)).resolves.toBe(5)
		await expect(setup.fm.entry_size(`${BOARD}/ws-1`)).resolves.toBe(0)
		await expect(setup.fm.entry_size(`${BOARD}/ws-1/a.txt`)).resolves.toBe(3)
	})
})

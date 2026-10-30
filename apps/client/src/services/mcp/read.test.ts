import { describe, expect, test } from 'vitest'
import { createFakeFileManager, type FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { DriveKind, FolderRef } from '@/domain/Drive'
import { get_context, get_folder, list_bookmarks, read_text } from './read'
import { FOLDER_ENTRY_LIMIT, McpError, TEXT_BYTE_LIMIT, TEXT_READ_LIMIT, type McpContext } from './types'

const HOME = '/home'

function local(folder_id: string, root_id = HOME): FolderRef {
	return { drive_id: 'local', root_id, folder_id }
}

function cloud(folder_id = '/'): FolderRef {
	return { drive_id: 'cloud', root_id: 'ws', folder_id }
}

type WorldOpts = {
	enabled?: boolean
	show_hidden?: boolean
	open?: FolderRef | null
	selection?: readonly string[]
	bookmarks?: readonly FolderRef[]
	realpath?: (path: string) => Promise<string>
	loaded?: (folder_id: string) => FolderWithChildrenXattrs | null
}

function world(opts: WorldOpts = {}) {
	const fake = createFakeFileManager()
	let loads = 0
	const ctx: McpContext = {
		enabled: opts.enabled ?? true,
		show_hidden: opts.show_hidden ?? false,
		open: opts.open === null
			? null
			: { ref: opts.open ?? local(HOME), selection: opts.selection ?? [] },
		bookmarks: opts.bookmarks ?? [],
		drive_kind(id: string): DriveKind | null {
			if (id === 'local' || id === 'cloud' || id === 'browser' || id === 'demo') return id
			return null
		},
		loaded_folder: opts.loaded ?? (() => null),
		async load_folder(id) {
			loads++
			return fake.fm.folder_with_children_xattrs(id)
		},
		read_file: id => fake.fm.read_text_file(id),
		entry_size: id => fake.fm.entry_size(id),
		realpath: opts.realpath ?? (async path => path),
	}
	return { fake, ctx, loads: () => loads }
}

const root_address = { drive_id: 'local', root_id: HOME, path: '' }

async function code_of(run: Promise<unknown>): Promise<string> {
	try {
		await run
	} catch (error) {
		expect(error).toBeInstanceOf(McpError)
		return (error as McpError).code
	}
	throw new Error('expected an MCP error')
}

describe('mcp read', () => {
	test('a direct child of the open folder is readable and its grandchild is not', async () => {
		const { fake, ctx } = world({ selection: [`${HOME}/note.txt`] })
		fake.seed_folder(HOME)
		fake.seed_file(`${HOME}/note.txt`, 'hello')
		fake.seed_folder(`${HOME}/sub`)
		fake.seed_folder(`${HOME}/sub/nested`)
		fake.seed_file(`${HOME}/sub/deep.txt`, 'no')

		const context = await get_context(ctx)
		expect(context.open).toMatchObject({
			folder: { drive_id: 'local', root_id: HOME, path: '' },
			name: 'home',
			readable: true,
			selection: [{ name: 'note.txt', path: 'note.txt', type: 'file' }],
		})

		const text = await read_text(ctx, { folder: root_address, path: 'note.txt' })
		expect(text).toEqual({ path: 'note.txt', text: 'hello', truncated: false })
		const sub = await get_folder(ctx, { ...root_address, path: 'sub' })
		expect(sub.entries.map(entry => entry.name).sort()).toEqual(['deep.txt', 'nested'])

		expect(await code_of(read_text(ctx, { folder: root_address, path: 'sub/deep.txt' }))).toBe('not_allowed')
		expect(await code_of(get_folder(ctx, { ...root_address, path: 'sub/nested' }))).toBe('not_allowed')
	})

	test('a bookmark reaches everything inside it', async () => {
		const { fake, ctx } = world({ bookmarks: [local(`${HOME}/projects`)] })
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/projects`)
		fake.seed_folder(`${HOME}/projects/app`)
		fake.seed_file(`${HOME}/projects/app/note.md`, 'inside')

		const text = await read_text(ctx, { folder: root_address, path: 'projects/app/note.md' })
		expect(text.text).toBe('inside')
		const folder = await get_folder(ctx, { ...root_address, path: 'projects/app' })
		expect(folder.entries.map(entry => entry.name)).toEqual(['note.md'])
	})

	test('listings omit .pile, and other dot names follow the hidden-files setting', async () => {
		const hidden = world()
		hidden.fake.seed_folder(HOME)
		hidden.fake.seed_folder(`${HOME}/.pile`)
		hidden.fake.seed_file(`${HOME}/.secret`, 'x')
		hidden.fake.seed_file(`${HOME}/note.txt`, 'n')

		const closed = await get_folder(hidden.ctx, root_address)
		expect(closed.entries.map(entry => entry.name)).toEqual(['note.txt'])
		expect(await code_of(read_text(hidden.ctx, { folder: root_address, path: '.pile/sync.json' }))).toBe('not_allowed')

		const shown = world({ show_hidden: true })
		shown.fake.seed_folder(HOME)
		shown.fake.seed_folder(`${HOME}/.pile`)
		shown.fake.seed_file(`${HOME}/.secret`, 'x')
		shown.fake.seed_file(`${HOME}/note.txt`, 'n')
		const open = await get_folder(shown.ctx, root_address)
		expect(open.entries.map(entry => entry.name).sort()).toEqual(['.secret', 'note.txt'])
	})

	test('a symlink that leaves the root is path_outside_root', async () => {
		const { fake, ctx } = world({
			realpath: async path => path === `${HOME}/link` ? '/etc/passwd' : path,
		})
		fake.seed_folder(HOME)
		fake.seed_file(`${HOME}/link`, 'no')

		expect(await code_of(read_text(ctx, { folder: root_address, path: 'link' }))).toBe('path_outside_root')
		expect(await code_of(get_folder(ctx, { ...root_address, path: '..' }))).toBe('path_outside_root')
		expect(await code_of(get_folder(ctx, { ...root_address, path: '/etc/passwd' }))).toBe('path_outside_root')
		expect(await code_of(read_text(ctx, { folder: root_address, path: 'a\0b' }))).toBe('path_outside_root')
	})

	test('text longer than 64 KiB comes back truncated', async () => {
		const { fake, ctx } = world()
		fake.seed_folder(HOME)
		fake.seed_file(`${HOME}/big.txt`, 'x'.repeat(TEXT_BYTE_LIMIT + 10))

		const text = await read_text(ctx, { folder: root_address, path: 'big.txt' })
		expect(text.truncated).toBe(true)
		expect(new TextEncoder().encode(text.text).byteLength).toBe(TEXT_BYTE_LIMIT)
	})

	test('a file over 8 MiB is too_large and is not read', async () => {
		const { fake, ctx } = world()
		fake.seed_folder(HOME)
		fake.seed_file(`${HOME}/huge.txt`, 'x'.repeat(TEXT_READ_LIMIT + 1))
		let reads = 0
		ctx.read_file = async (id) => {
			reads++
			return fake.fm.read_text_file(id)
		}

		expect(await code_of(read_text(ctx, { folder: root_address, path: 'huge.txt' }))).toBe('too_large')
		expect(reads).toBe(0)
	})

	test('cloud and browser drives are not readable in v1', async () => {
		const { ctx } = world({
			open: cloud(),
			bookmarks: [cloud(), local(`${HOME}/projects`), { drive_id: 'browser', root_id: '/browser-desktops', folder_id: '/browser-desktops' }],
		})
		const context = await get_context(ctx)
		expect(context.open?.readable).toBe(false)
		expect(context.open?.selection).toEqual([])

		expect(await code_of(get_folder(ctx, { drive_id: 'cloud', root_id: 'ws', path: '' }))).toBe('drive_not_in_v1')
		expect(await code_of(read_text(ctx, {
			folder: { drive_id: 'browser', root_id: '/browser-desktops', path: '' },
			path: 'a.txt',
		}))).toBe('drive_not_in_v1')

		const listed = await list_bookmarks(ctx)
		expect(listed.bookmarks).toEqual([
			{ folder: { drive_id: 'local', root_id: HOME, path: 'projects' }, name: 'projects' },
		])
	})

	test('turned-off access is mcp_disabled', async () => {
		const { ctx } = world({ enabled: false })
		expect(await code_of(get_context(ctx))).toBe('mcp_disabled')
		expect(await code_of(list_bookmarks(ctx))).toBe('mcp_disabled')
		expect(await code_of(get_folder(ctx, root_address))).toBe('mcp_disabled')
		expect(await code_of(read_text(ctx, { folder: root_address, path: 'a.txt' }))).toBe('mcp_disabled')
	})

	test('an unloaded folder is read through xattrs_map, and a stored grid view is gallery', async () => {
		const { fake, ctx, loads } = world()
		fake.seed_folder(HOME)
		fake.seed_file(`${HOME}/note.txt`, '')
		fake.set_xattr(HOME, 'view', 'grid')
		fake.set_xattr(`${HOME}/note.txt`, 'position', '{"x":4,"y":5}')
		fake.set_xattr(`${HOME}/note.txt`, 'is_preview', 'true')

		const folder = await get_folder(ctx, root_address)
		expect(loads()).toBe(1)
		expect(folder.view).toBe('gallery')
		expect(folder.entries).toEqual([
			{
				name: 'note.txt',
				path: 'note.txt',
				type: 'file',
				position: { x: 4, y: 5 },
				is_preview: true,
			},
		])
	})

	test('the open store is used when the folder is already loaded', async () => {
		const loaded: FolderWithChildrenXattrs = {
			id: HOME,
			name: 'home',
			type: 'folder',
			xattrs: [{ name: 'view', value: 'board' }],
			children: [{
				id: `${HOME}/note.txt`,
				name: 'note.txt',
				type: 'file',
				xattrs: [{ name: 'order', value: '3' }],
			}],
		}
		const { ctx, loads } = world({ loaded: id => id === HOME ? loaded : null })
		const folder = await get_folder(ctx, root_address)
		expect(loads()).toBe(0)
		expect(folder.view).toBe('board')
		expect(folder.entries[0]).toMatchObject({ order: 3 })
	})

	test('a folder listing stops at 200 entries', async () => {
		const { fake, ctx } = world()
		fake.seed_folder(HOME)
		for (let i = 0; i < FOLDER_ENTRY_LIMIT + 1; i++) fake.seed_file(`${HOME}/f${i}.txt`, '')
		const folder = await get_folder(ctx, root_address)
		expect(folder.truncated).toBe(true)
		expect(folder.entries).toHaveLength(FOLDER_ENTRY_LIMIT)
	})
})

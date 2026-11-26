import { describe, expect, test, vi } from 'vitest'
import { createFakeFileManager, type FakeFileManager, type FileManager } from '@pile-commander/file-manager'
import { invoke } from '@tauri-apps/api/core'
import { build_cloud_workspace_pile, export_cloud_workspace_to_pile, import_workspace_from_pile, list_pile_tree, pile_root_name, pile_zip_entries } from './pack'

const imported = vi.hoisted(() => ({ fm: null as FileManager | null }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => '/import/Board'), isTauri: () => false }))
vi.mock('@tauri-apps/api/path', () => ({
	join: async (...parts: string[]) => parts.join('/'),
	basename: async (path: string) => path.split('/').pop() ?? path,
}))
vi.mock('@pile-commander/file-manager', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@pile-commander/file-manager')>()
	return { ...actual, createFileManager: () => imported.fm }
})

function bytes(size: number): Blob {
	return new Blob([new Uint8Array(size)])
}

/** A cloud-style workspace (root "/"): nested and empty folders, a note, media, layout, a stray `.pile`. */
async function make_workspace(): Promise<FakeFileManager> {
	const ws = createFakeFileManager()
	ws.seed_folder('/')
	ws.seed_folder('/Доска')
	ws.seed_folder('/Доска/refs')
	ws.seed_folder('/empty')
	ws.seed_folder('/.pile')
	ws.seed_file('/.pile/attrs.json', '{"version":1,"attrs":{}}')
	ws.seed_file('/Доска/note.md', '# hello')
	await ws.fm.upload_file('/Доска/refs', 'photo.png', bytes(2048), 'image/png')
	ws.set_xattr('/Доска/note.md', 'position', '{"x":10,"y":20}')
	return ws
}

function occurrences(haystack: string, needle: string): number {
	return haystack.split(needle).length - 1
}

describe('pile_root_name', () => {
	test('keeps a plain workspace name', () => {
		expect(pile_root_name('Moodboard 2026')).toBe('Moodboard 2026')
	})

	test('replaces what file systems refuse and drops leading dots', () => {
		expect(pile_root_name('a/b\\c:d*e?f"g<h>i|j')).toBe('a_b_c_d_e_f_g_h_i_j')
		expect(pile_root_name('..hidden')).toBe('hidden')
		expect(pile_root_name('   ')).toBe('workspace')
	})
})

describe('list_pile_tree', () => {
	test('walks from the root, parents before children, and leaves .pile out', async () => {
		const tree = await list_pile_tree((await make_workspace()).fm)
		const folders = tree.folders.map(segments => segments.join('/'))
		expect([...folders].sort()).toEqual(['empty', 'Доска', 'Доска/refs'].sort())
		expect(folders.indexOf('Доска')).toBeLessThan(folders.indexOf('Доска/refs'))
		expect([...tree.files].sort((a, b) => a.id.localeCompare(b.id))).toEqual([
			{ id: '/Доска/note.md', name: 'note.md', segments: ['Доска', 'note.md'] },
			{ id: '/Доска/refs/photo.png', name: 'photo.png', segments: ['Доска', 'refs', 'photo.png'] },
		])
	})
})

describe('pile_zip_entries', () => {
	test('one root folder: folder entries, the files, the manifest last', () => {
		const photo = bytes(3)
		const tree = {
			folders: [['a'], ['a', 'empty']],
			files: [{ id: '/a/x.png', name: 'x.png', segments: ['a', 'x.png'] }],
		}
		expect(pile_zip_entries('Board', tree, new Map([['/a/x.png', photo]]), '{}')).toEqual([
			{ name: 'Board/a/' },
			{ name: 'Board/a/empty/' },
			{ name: 'Board/a/x.png', input: photo },
			{ name: 'Board/.pile/attrs.json', input: '{}' },
		])
	})

	test('a file without bytes is an error, not a hole in the archive', () => {
		const tree = { folders: [], files: [{ id: '/x.png', name: 'x.png', segments: ['x.png'] }] }
		expect(() => pile_zip_entries('Board', tree, new Map(), '{}')).toThrow('x.png')
	})
})

describe('build_cloud_workspace_pile', () => {
	test('zips the workspace the way the desktop import reads it', async () => {
		const ws = await make_workspace()
		const seen: number[] = []
		const blob = await build_cloud_workspace_pile(ws.fm, 'My: board', progress => seen.push(progress.file_index))
		const zip = new Uint8Array(await blob.arrayBuffer())
		expect([...zip.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])
		// stored entries: names show in a local header and again in the central
		// directory, file bytes as they are
		const text = new TextDecoder().decode(zip)
		expect(occurrences(text, 'My_ board/empty/')).toBe(2)
		expect(occurrences(text, 'My_ board/Доска/refs/photo.png')).toBe(2)
		expect(occurrences(text, 'My_ board/Доска/note.md')).toBe(2)
		// the workspace's own .pile stays out: one manifest, the archive's
		expect(occurrences(text, 'My_ board/.pile/attrs.json')).toBe(2)
		expect(text).toContain('# hello')
		expect(text).toContain('"position": "{\\"x\\":10,\\"y\\":20}"')
		expect(seen.sort()).toEqual([1, 2])
	})

	test('a cover file is in the archive and other .pile files are not', async () => {
		const ws = await make_workspace()
		ws.seed_folder('/Доска/.pile')
		ws.seed_file('/Доска/.pile/cover-abcdef01.webp', 'webp-bytes')
		ws.seed_file('/Доска/.pile/strokes.json', '{}')
		const blob = await build_cloud_workspace_pile(ws.fm, 'Board')
		const text = new TextDecoder().decode(new Uint8Array(await blob.arrayBuffer()))
		expect(occurrences(text, 'Board/Доска/.pile/cover-abcdef01.webp')).toBe(2)
		expect(text).toContain('webp-bytes')
		expect(text).not.toContain('strokes.json')
		expect(occurrences(text, 'Board/.pile/attrs.json')).toBe(2)
	})

	test('finds a cover by the .pile path when the listing hides that folder', async () => {
		const ws = await make_workspace()
		ws.seed_folder('/Доска/.pile')
		ws.seed_file('/Доска/.pile/cover-abcdef01.webp', 'webp-bytes')
		ws.seed_file('/Доска/.pile/strokes.json', '{}')
		const fm = {
			...ws.fm,
			pile_images: true,
			async FolderChildren(id: string) {
				const children = await ws.fm.FolderChildren(id)
				return children.filter(child => child.name !== '.pile')
			},
		}
		const tree = await list_pile_tree(fm)
		expect(tree.files.map(file => file.segments.join('/'))).toContain('Доска/.pile/cover-abcdef01.webp')
		expect(tree.folders.map(segments => segments.join('/'))).toContain('Доска/.pile')
		expect(tree.files.map(file => file.name)).not.toContain('strokes.json')
		expect(tree.folders.map(segments => segments.join('/'))).not.toContain('.pile')
	})

	test('a file that cannot be read stops the whole archive', async () => {
		const ws = await make_workspace()
		ws.fail_once('get_media_src')
		await expect(build_cloud_workspace_pile(ws.fm, 'Board')).rejects.toThrow('get_media_src')
	})
})

const ROOT_COVER = 'pile:cover-abcdef01.webp'

function seed_imported_root(): FakeFileManager {
	const ws = createFakeFileManager()
	ws.seed_folder('/import/Board')
	ws.seed_folder('/import/Board/.pile')
	ws.seed_file('/import/Board/.pile/attrs.json', JSON.stringify({
		version: 1,
		attrs: { '': { cover: ROOT_COVER } },
	}))
	ws.seed_file('/import/Board/.pile/cover-abcdef01.webp', 'webp-bytes')
	imported.fm = ws.fm
	return ws
}

describe('importing a .pile keeps the root cover', () => {
	test('removes attrs.json and leaves the cover file', async () => {
		const ws = seed_imported_root()
		const imported_root = await import_workspace_from_pile('/tmp/Board.pile', '/import')
		expect(imported_root).toEqual({ root: '/import/Board', name: 'Board' })
		expect(ws.has('/import/Board/.pile/cover-abcdef01.webp')).toBe(true)
		expect(ws.has('/import/Board/.pile/attrs.json')).toBe(false)
		expect(ws.get_xattr('/import/Board', 'cover')).toBe(ROOT_COVER)
	})

	test('a layout that cannot be read takes the unpacked folder away, so the import can be run again', async () => {
		const ws = seed_imported_root()
		ws.seed_file('/import/Board/.pile/attrs.json', '{ not json')
		ws.seed_file('/import/Board/note.md', '# hello')
		await expect(import_workspace_from_pile('/tmp/Board.pile', '/import')).rejects.toThrow('layout file (.pile/attrs.json) cannot be read')
		expect(ws.has('/import/Board')).toBe(false)
		expect(ws.has('/import/Board/note.md')).toBe(false)
	})
})

describe('export_cloud_workspace_to_pile', () => {
	type Call = { command: string; args: unknown; headers?: Record<string, string> }

	/** Records what Rust is asked to write; `fail` makes one command throw. */
	function record_archive(fail?: string): Call[] {
		const calls: Call[] = []
		vi.mocked(invoke).mockImplementation(async (command: string, args?: unknown, options?: unknown) => {
			calls.push({ command, args, headers: (options as { headers?: Record<string, string> } | undefined)?.headers })
			if (command === fail) throw new Error('disk full')
			return command === 'pile_zip_begin' ? 7 : undefined
		})
		return calls
	}

	const entry_path = (call: Call) => JSON.parse(decodeURIComponent(call.headers!['x-pile-zip-path']!)) as string[]

	test('writes the folders, then every file, then the layout, into one archive', async () => {
		const ws = await make_workspace()
		const calls = record_archive()
		const progress: number[] = []
		const packing = vi.fn()

		await export_cloud_workspace_to_pile(ws.fm, 'Trip / 2026', '/Users/ann/Downloads/Trip.pile', p => progress.push(p.file_index), packing)

		expect(calls[0]).toMatchObject({
			command: 'pile_zip_begin',
			args: { zipPath: '/Users/ann/Downloads/Trip.pile', rootName: 'Trip _ 2026' },
		})
		const folders = calls.filter(call => call.command === 'pile_zip_folder').map(call => (call.args as { segments: string[] }).segments.join('/'))
		expect(folders).toEqual(expect.arrayContaining(['Доска', 'Доска/refs', 'empty']))
		expect(folders.indexOf('Доска')).toBeLessThan(folders.indexOf('Доска/refs'))

		const files = calls.filter(call => call.command === 'pile_zip_file')
		expect(files.map(call => entry_path(call).join('/')).sort()).toEqual(['Доска/note.md', 'Доска/refs/photo.png'])
		for (const file of files) {
			expect(file.headers!['x-pile-zip-id']).toBe('7')
			// a header holds ASCII only
			expect(file.headers!['x-pile-zip-path']).toMatch(/^[\x20-\x7e]+$/)
			expect(file.args).toBeInstanceOf(Uint8Array)
		}
		expect((files.find(call => entry_path(call).at(-1) === 'photo.png')!.args as Uint8Array).byteLength).toBe(2048)

		const last = calls.at(-1)!
		expect(last.command).toBe('pile_zip_finish')
		const manifest = JSON.parse((last.args as { id: number; attrsJson: string }).attrsJson)
		expect(JSON.stringify(manifest)).toContain('position')
		expect(calls.some(call => call.command === 'pile_zip_abort')).toBe(false)
		expect(progress).toEqual([1, 2])
		expect(packing).toHaveBeenCalledTimes(1)
	})

	test('a failure drops the unfinished archive and is reported', async () => {
		const ws = await make_workspace()
		const calls = record_archive('pile_zip_file')

		await expect(export_cloud_workspace_to_pile(ws.fm, 'Trip', '/Users/ann/Downloads/Trip.pile')).rejects.toThrow('disk full')

		expect(calls.at(-1)).toMatchObject({ command: 'pile_zip_abort', args: { id: 7 } })
		expect(calls.some(call => call.command === 'pile_zip_finish')).toBe(false)
	})
})

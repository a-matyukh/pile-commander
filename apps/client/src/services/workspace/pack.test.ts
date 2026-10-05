import { describe, expect, test } from 'vitest'
import { createFakeFileManager, type FakeFileManager } from '@pile-commander/file-manager'
import { build_cloud_workspace_pile, list_pile_tree, pile_root_name, pile_zip_entries } from './pack'

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

	test('a file that cannot be read stops the whole archive', async () => {
		const ws = await make_workspace()
		ws.fail_once('get_media_src')
		await expect(build_cloud_workspace_pile(ws.fm, 'Board')).rejects.toThrow('get_media_src')
	})
})

import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createFakeFileManager, type FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import { memory_folder_list_disk, type FolderListDisk } from './folderListDisk'
import {
	keep_folder_lists,
	keep_note_texts,
	recall_note_text,
	recall_folder_list,
	remember_folder_list,
	reset_folder_list_cache,
	set_folder_list_disk,
	set_folder_list_owner,
} from './folderListCache'

const list = (name: string): FolderWithChildrenXattrs => ({
	id: '/docs',
	name: 'docs',
	type: 'folder',
	xattrs: [],
	children: [{ id: `/docs/${name}`, name, type: 'file', xattrs: [] }],
})

function memory_note_disk() {
	const rows = new Map<string, string>()
	return {
		async get(key: string) { return rows.get(key) ?? null },
		async put(key: string, text: string) { rows.set(key, text) },
		async clear() { rows.clear() },
	}
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

let disk: ReturnType<typeof memory_folder_list_disk>

beforeEach(async () => {
	const rows = new Map<string, string>()
	vi.stubGlobal('localStorage', {
		getItem: (key: string) => rows.get(key) ?? null,
		setItem: (key: string, value: string) => { rows.set(key, value) },
		removeItem: (key: string) => { rows.delete(key) },
		clear: () => rows.clear(),
	})
	await reset_folder_list_cache()
	disk = memory_folder_list_disk()
	set_folder_list_disk(disk, { notes: memory_note_disk() })
	set_folder_list_owner('me')
})

afterEach(async () => {
	await reset_folder_list_cache()
	vi.unstubAllGlobals()
})

describe('folder lists kept on this device', () => {
	test('what the cloud said comes back for the same account, workspace and folder', async () => {
		remember_folder_list('ws', '/docs', list('a.md'))
		await settle()
		expect((await recall_folder_list('ws', '/docs'))?.children?.[0]?.name).toBe('a.md')
		expect(await recall_folder_list('other-ws', '/docs')).toBeNull()
	})

	test('the snapshot is taken as the answer arrives: changing the caller copy after does not change it', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/')
		fake.seed_file('/a.md', 'x')
		const fm = keep_folder_lists(fake.fm, 'ws')
		const answer = await fm.folder_with_children_xattrs('/')
		// the store lays a look still being saved over its own copy
		answer.xattrs.push({ name: 'view', value: 'board' })
		answer.children![0]!.xattrs.push({ name: 'position', value: 'pending' })
		await settle()
		const kept = await recall_folder_list('ws', '/')
		expect(kept?.xattrs).toEqual([])
		expect(kept?.children?.[0]?.xattrs).toEqual([])
	})

	test('signed out: nothing is kept or read', async () => {
		await reset_folder_list_cache()
		remember_folder_list('ws', '/docs', list('a.md'))
		await settle()
		expect(disk.keys()).toEqual([])
		expect(await recall_folder_list('ws', '/docs')).toBeNull()
	})

	test('a write on its way when the account signs out lands nowhere', async () => {
		let finish: () => void = () => {}
		const slow: FolderListDisk = {
			...disk,
			async put(key, value) {
				await new Promise<void>(resolve => { finish = resolve })
				await disk.put(key, value)
			},
		}
		set_folder_list_disk(slow)
		remember_folder_list('ws', '/docs', list('a.md'))
		await settle()
		const wiped = reset_folder_list_cache()
		finish()
		await wiped
		expect(disk.keys()).toEqual([])
	})

	test('another account on the same device starts empty', async () => {
		remember_folder_list('ws', '/docs', list('a.md'))
		await settle()
		set_folder_list_owner('someone else')
		await settle()
		expect(disk.keys()).toEqual([])
		expect(await recall_folder_list('ws', '/docs')).toBeNull()
	})

	test('a slow disk is a miss, not a wait', async () => {
		set_folder_list_disk({ ...disk, get: () => new Promise(() => {}) }, { wait_ms: 5 })
		expect(await recall_folder_list('ws', '/docs')).toBeNull()
		set_folder_list_disk(disk, { wait_ms: 150 })
	})
})

describe('a cloud note\'s text kept on the device', () => {
	test('a read and a save keep the text; the next session shows it before the cloud answers', async () => {
		const fake = createFakeFileManager()
		fake.seed_file('/a.md', 'hello')
		const fm = keep_note_texts(fake.fm, 'ws-1')
		expect(await recall_note_text('ws-1', '/a.md')).toBeNull()

		await fm.read_text_file('/a.md')
		await settle()
		expect(await recall_note_text('ws-1', '/a.md')).toBe('hello')

		await fm.save_text_file('/a.md', 'bye')
		await settle()
		expect(await recall_note_text('ws-1', '/a.md')).toBe('bye')
		// another workspace's note of the same path is another note
		expect(await recall_note_text('ws-2', '/a.md')).toBeNull()
	})

	test('sign-out forgets the texts; another account does not see them', async () => {
		const fake = createFakeFileManager()
		fake.seed_file('/a.md', 'secret')
		await keep_note_texts(fake.fm, 'ws-1').read_text_file('/a.md')
		await settle()
		set_folder_list_owner('someone-else')
		await settle()
		expect(await recall_note_text('ws-1', '/a.md')).toBeNull()
		set_folder_list_owner('me')
		expect(await recall_note_text('ws-1', '/a.md')).toBeNull()
	})
})

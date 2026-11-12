import { describe, expect, test } from 'vitest'
import { find_moved_folder_in, type FoundDirEntry } from './findMoved'

/** A tiny disk: folder → entries; link files by folder */
function disk(tree: Record<string, string[]>, link_files: Record<string, string>) {
	const read: string[] = []
	return {
		read,
		deps: {
			list: async (folder: string): Promise<FoundDirEntry[]> => {
				if (!tree[folder]) throw new Error('missing')
				return tree[folder].map(name => ({ name: name.replace('@', ''), isDirectory: true, isSymlink: name.startsWith('@') }))
			},
			read_link_file: async (folder: string) => {
				read.push(folder)
				return link_files[folder] ?? null
			},
			matches: (_folder: string, text: string) => text === 'mine',
		},
	}
}

describe('a synced folder moved in Finder into another one', () => {
	const tree = {
		'/me/poem': ['.pile', 'drafts', 'sync test'],
		'/me/poem/drafts': [],
		'/me/poem/sync test': ['.pile', 'notes'],
		'/me/poem/sync test/notes': [],
	}

	test('is found by its own link file inside the other synced folder', async () => {
		const { deps, read } = disk(tree, { '/me/poem/sync test': 'mine' })
		expect(await find_moved_folder_in(['/me/poem'], deps)).toBe('/me/poem/sync test')
		// only folders with .pile are read, and never the synced folder's own file
		expect(read).toEqual(['/me/poem/sync test'])
	})

	test('another link file, hidden folders and symlinks do not count', async () => {
		const { deps } = disk({
			'/me/poem': ['.git', '@link', 'other'],
			'/me/poem/.git': ['.pile'],
			'/me/poem/link': ['.pile'],
			'/me/poem/other': ['.pile'],
		}, { '/me/poem/.git': 'mine', '/me/poem/link': 'mine', '/me/poem/other': 'theirs' })
		expect(await find_moved_folder_in(['/me/poem'], deps)).toBeNull()
	})

	test('stops after the limit', async () => {
		const { deps } = disk(tree, { '/me/poem/sync test': 'mine' })
		expect(await find_moved_folder_in(['/me/poem'], deps, 2)).toBeNull()
	})
})

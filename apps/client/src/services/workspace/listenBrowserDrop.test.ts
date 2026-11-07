import { describe, expect, test } from 'vitest'
import { dropped_files } from './listenBrowserDrop'

function item(name: string, directory = false) {
	const file = new File(['x'], name)
	return {
		kind: 'file',
		getAsFile: () => file,
		webkitGetAsEntry: () => ({ isDirectory: directory }),
	}
}

describe('dropped_files', () => {
	test('takes the files and leaves folders out', () => {
		const data = { items: [item('a.png'), item('Photos', true), item('b.txt')], files: [] } as unknown as DataTransfer
		const { files, skipped_folders } = dropped_files(data)
		expect(files.map(file => file.name)).toEqual(['a.png', 'b.txt'])
		expect(skipped_folders).toBe(1)
	})

	test('falls back to the file list when there are no items', () => {
		const data = { items: [], files: [new File(['x'], 'c.jpg')] } as unknown as DataTransfer
		expect(dropped_files(data).files.map(file => file.name)).toEqual(['c.jpg'])
	})
})

import { describe, expect, test } from 'vitest'
import { visible_selection_ids } from './useClipboardShortcuts'

describe('useClipboardShortcuts', () => {
	test('copy cut and duplicate keep only ids that are in the visible children', () => {
		const visible = [{ id: '/ws/note.txt' }, { id: '/ws/pics' }]
		const selection = ['/ws/.env', '/ws/note.txt']

		expect(visible_selection_ids(selection, visible)).toEqual(['/ws/note.txt'])
		expect(visible_selection_ids(selection, [])).toEqual([])
		expect(visible_selection_ids(selection, undefined)).toEqual([])
	})

	test('includes a dotfile once it is in the visible list', () => {
		const visible = [{ id: '/ws/.env' }, { id: '/ws/note.txt' }]
		expect(visible_selection_ids(['/ws/.env', '/ws/note.txt'], visible)).toEqual([
			'/ws/.env',
			'/ws/note.txt',
		])
	})
})

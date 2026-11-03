import { describe, expect, test } from 'vitest'
import { show_hidden_files } from '@/store/showHiddenFiles'
import { entry_is_listed } from '@/store/hiddenPaths'
import { is_listed_trash_row } from './hiddenName'

describe('hidden pile files', () => {
	test('with hidden files off, .pile is absent from the folder list and the trash', () => {
		show_hidden_files.value = false
		expect(entry_is_listed('.pile', '/board/.pile')).toBe(false)
		expect(is_listed_trash_row('.pile', '/board/.pile', false)).toBe(false)
		expect(is_listed_trash_row('cover-abcdef01.webp', '/board/.pile/cover-abcdef01.webp', false)).toBe(false)
		expect(is_listed_trash_row('note.md', '/board/note.md', false)).toBe(true)

		show_hidden_files.value = true
		expect(entry_is_listed('.pile', '/board/.pile')).toBe(true)
		expect(is_listed_trash_row('cover-abcdef01.webp', '/board/.pile/cover-abcdef01.webp', true)).toBe(true)
		show_hidden_files.value = false
	})
})

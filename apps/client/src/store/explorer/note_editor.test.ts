import { expect, test } from 'vitest'
import { is_note_file, opens_in_editor } from './note_editor'

test('a note opens in the note editor, a local one on the desktop in its program', () => {
	expect(is_note_file('/a/Note.md')).toBe(true)
	expect(is_note_file('/a/todo.TXT')).toBe(true)
	expect(is_note_file('/a/pic.png')).toBe(false)
	expect(opens_in_editor('cloud', '/a.md', true)).toBe(true)
	expect(opens_in_editor('browser', '/a.txt', false)).toBe(true)
	expect(opens_in_editor('demo', '/a.md', false)).toBe(true)
	expect(opens_in_editor('local', '/a.md', true)).toBe(false)
	expect(opens_in_editor('cloud', '/a.pdf', true)).toBe(false)
})

import { describe, expect, test } from 'vitest'
import {
	resolve_folder_name,
	resolve_markdown_file_name,
	resolve_note_filename,
	resolve_shape_filename,
	resolve_text_file_name,
	resolve_unique_filename,
} from './uniqueName'

describe('uniqueName', () => {
	test('resolve_note_filename and resolve_shape_filename skip taken numbers', () => {
		expect(resolve_note_filename([])).toBe('Note 1.md')
		expect(resolve_note_filename(['Note 1.md', 'Note 2.md'])).toBe('Note 3.md')
		expect(resolve_shape_filename(['Shape 1.svg'])).toBe('Shape 2.svg')
	})

	test('resolve_folder_name skips taken numbers', () => {
		expect(resolve_folder_name([])).toBe('New folder 1')
		expect(resolve_folder_name(['New folder 1', 'New folder 2'])).toBe('New folder 3')
	})

	test('resolve_text_file_name skips taken numbers', () => {
		expect(resolve_text_file_name([])).toBe('New text file 1.txt')
		expect(resolve_text_file_name(['New text file 1.txt', 'New text file 2.txt'])).toBe('New text file 3.txt')
	})

	test('resolve_markdown_file_name skips taken numbers', () => {
		expect(resolve_markdown_file_name([])).toBe('New markdown file 1.md')
		expect(resolve_markdown_file_name(['New markdown file 1.md', 'New markdown file 2.md'])).toBe('New markdown file 3.md')
	})

	test('resolve_unique_filename returns original when free', () => {
		expect(resolve_unique_filename('file.txt', ['other.txt'])).toBe('file.txt')
	})

	test('resolve_unique_filename uses note numbering for Note N.md collisions', () => {
		expect(resolve_unique_filename('Note 1.md', ['Note 1.md'])).toBe('Note 2.md')
	})

	test('resolve_unique_filename appends (n) for other collisions', () => {
		expect(resolve_unique_filename('photo.png', ['photo.png'])).toBe('photo (1).png')
		expect(resolve_unique_filename('photo.png', ['photo.png', 'photo (1).png'])).toBe('photo (2).png')
		expect(resolve_unique_filename('README', ['README'])).toBe('README (1)')
	})
})

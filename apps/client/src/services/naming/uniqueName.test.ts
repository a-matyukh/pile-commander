import { describe, expect, test } from 'vitest'
import {
	resolve_folder_name,
	resolve_markdown_file_name,
	resolve_note_filename,
	resolve_shape_filename,
	resolve_text_block_filename,
	resolve_text_file_name,
	resolve_unique_filename,
} from './uniqueName'

describe('uniqueName', () => {
	test('resolve_note_filename and resolve_shape_filename skip taken numbers', () => {
		expect(resolve_note_filename([])).toBe('Note 1.md')
		expect(resolve_note_filename(['Note 1.md', 'Note 2.md'])).toBe('Note 3.md')
		expect(resolve_shape_filename(['Shape 1.svg'])).toBe('Shape 2.svg')
	})

	test('resolve_text_block_filename numbers apart from notes', () => {
		expect(resolve_text_block_filename([])).toBe('Text 1.md')
		expect(resolve_text_block_filename(['Text 1.md', 'Text 3.md'])).toBe('Text 2.md')
		expect(resolve_text_block_filename(['Note 1.md', 'Note 2.md'])).toBe('Text 1.md')
		expect(resolve_note_filename(['Text 1.md'])).toBe('Note 1.md')
	})

	test('resolve_unique_filename keeps the Text prefix when a Text N.md collides', () => {
		expect(resolve_unique_filename('Text 1.md', ['Text 1.md'])).toBe('Text 2.md')
		expect(resolve_unique_filename('Text 1.md', ['Text 1.md', 'Note 2.md'])).toBe('Text 2.md')
		expect(resolve_unique_filename('Text 1.md', ['text 1.md'], { ignore_case: true })).toBe('Text 2.md')
	})

	test('resolve_folder_name skips taken numbers in the given language', () => {
		expect(resolve_folder_name([], 'New folder')).toBe('New folder 1')
		expect(resolve_folder_name(['New folder 1', 'New folder 2'], 'New folder')).toBe('New folder 3')
		expect(resolve_folder_name([], 'Новая папка')).toBe('Новая папка 1')
		expect(resolve_folder_name(['Новая папка 1', 'New folder 1'], 'Новая папка')).toBe('Новая папка 2')
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

	test('resolve_unique_filename can ignore case, as macOS and Windows file systems do', () => {
		expect(resolve_unique_filename('Beach.jpg', ['beach.jpg'])).toBe('Beach.jpg')
		expect(resolve_unique_filename('Beach.jpg', ['beach.jpg'], { ignore_case: true })).toBe('Beach (1).jpg')
		expect(resolve_unique_filename('Beach.jpg', ['beach.jpg', 'beach (1).JPG'], { ignore_case: true })).toBe('Beach (2).jpg')
		expect(resolve_unique_filename('Note 1.md', ['note 1.md'], { ignore_case: true })).toBe('Note 2.md')
	})

	test('resolve_unique_filename with ignore_case also ignores Unicode composition (NFC vs NFD)', () => {
		const nfc = 'Пляж и мой зонт.jpg'.normalize('NFC')
		const nfd = 'Пляж и мой зонт.jpg'.normalize('NFD')
		expect(nfc).not.toBe(nfd)
		expect(resolve_unique_filename(nfc, [nfd], { ignore_case: true })).toBe('Пляж и мой зонт (1).jpg'.normalize('NFC'))
		expect(resolve_unique_filename('Café.jpg'.normalize('NFC'), ['café.jpg'.normalize('NFD')], { ignore_case: true }))
			.toBe('Café (1).jpg'.normalize('NFC'))
	})

	test('resolve_unique_filename keeps a leading dot so the copy stays hidden', () => {
		expect(resolve_unique_filename('.git', ['.git'])).toBe('.git (1)')
		expect(resolve_unique_filename('.env', ['.env'])).toBe('.env (1)')
		expect(resolve_unique_filename('.env.local', ['.env.local'])).toBe('.env (1).local')
	})

	test('resolve_unique_filename appends (n) for other collisions', () => {
		expect(resolve_unique_filename('photo.png', ['photo.png'])).toBe('photo (1).png')
		expect(resolve_unique_filename('photo.png', ['photo.png', 'photo (1).png'])).toBe('photo (2).png')
		expect(resolve_unique_filename('README', ['README'])).toBe('README (1)')
	})
})

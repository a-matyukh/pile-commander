import { describe, expect, test } from 'vitest'
import { folder_view_from_stored, stored_folder_view } from './Widget'

describe('a folder view as stored', () => {
	test('Gallery is stored as "gallery"; other views as their names', () => {
		expect(stored_folder_view('grid')).toBe('gallery')
		expect(stored_folder_view('board')).toBe('board')
		expect(stored_folder_view('list')).toBe('list')
	})

	test('"gallery" and "grid", written by earlier versions, both read as Gallery', () => {
		expect(folder_view_from_stored('gallery')).toBe('grid')
		expect(folder_view_from_stored('grid')).toBe('grid')
		expect(folder_view_from_stored(stored_folder_view('slides'))).toBe('slides')
	})

	test('none or anything unknown is a list', () => {
		expect(folder_view_from_stored(undefined)).toBe('list')
		expect(folder_view_from_stored('dashboard')).toBe('list')
	})
})

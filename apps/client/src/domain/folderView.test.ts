import { describe, expect, test } from 'vitest'
import { parse_xattr_value } from '@/services/workspace/xattrs'
import { FOLDER_VIEWS, folder_view_from_stored, stored_folder_view } from './Widget'

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

	test('dashboard is its own view', () => {
		expect(folder_view_from_stored('dashboard')).toBe('dashboard')
		expect(stored_folder_view('dashboard')).toBe('dashboard')
	})

	test('3D is stored as "3d" and stays a word when an attribute is read', () => {
		expect(stored_folder_view('3d')).toBe('3d')
		expect(folder_view_from_stored('3d')).toBe('3d')
		// xattrs come as strings: "3d" must not turn into a number on the way
		expect(folder_view_from_stored(parse_xattr_value('3d'))).toBe('3d')
	})

	test('3D sits right after the canvas: board, canvas and 3D go together in the View menu', () => {
		const at = FOLDER_VIEWS.indexOf('canvas')
		expect(FOLDER_VIEWS[at - 1]).toBe('board')
		expect(FOLDER_VIEWS[at + 1]).toBe('3d')
	})

	test('none or anything unknown is a list', () => {
		expect(folder_view_from_stored(undefined)).toBe('list')
		expect(folder_view_from_stored('nope')).toBe('list')
	})
})

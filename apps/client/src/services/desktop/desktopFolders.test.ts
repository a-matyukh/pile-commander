import { describe, expect, it } from 'vitest'
import { orphaned_desktop_ids, validate_desktop_folder_path } from './desktopFolders'

describe('orphaned_desktop_ids', () => {
	it('returns names that belong to no live desktop', () => {
		expect(orphaned_desktop_ids(['a', 'b', 'c'], new Set(['a', 'c']))).toEqual(['b'])
	})

	it('returns nothing when everything is valid or the root is empty', () => {
		expect(orphaned_desktop_ids(['a'], new Set(['a']))).toEqual([])
		expect(orphaned_desktop_ids([], new Set(['a']))).toEqual([])
	})

	it('treats every folder as orphaned after a localStorage reset', () => {
		expect(orphaned_desktop_ids(['a', 'b'], new Set())).toEqual(['a', 'b'])
	})
})

describe('validate_desktop_folder_path', () => {
	const home = '/Users/me'

	it('accepts a folder inside the home folder', () => {
		expect(validate_desktop_folder_path('/Users/me/Work', home, [])).toBeNull()
		expect(validate_desktop_folder_path('/Users/me/docs/nested', home, [])).toBeNull()
	})

	it('rejects paths outside the home folder (outside the fs scope)', () => {
		expect(validate_desktop_folder_path('/Volumes/usb/desk', home, [])).toMatch(/home folder/)
		expect(validate_desktop_folder_path('/Users/shared', home, [])).toMatch(/home folder/)
		// a prefix lookalike is not inside home
		expect(validate_desktop_folder_path('/Users/me-other/desk', home, [])).toMatch(/home folder/)
	})

	it('rejects the home folder itself', () => {
		expect(validate_desktop_folder_path('/Users/me', home, [])).toMatch(/subfolder/)
	})

	it('rejects a folder already adopted by another desktop', () => {
		expect(validate_desktop_folder_path('/Users/me/Work', home, ['/Users/me/Work']))
			.toMatch(/already used/)
	})

	it('accepts a sibling of a taken folder', () => {
		expect(validate_desktop_folder_path('/Users/me/Play', home, ['/Users/me/Work'])).toBeNull()
	})

	it('tolerates a trailing slash in the home path', () => {
		expect(validate_desktop_folder_path('/Users/me/Work', '/Users/me/', [])).toBeNull()
	})

	it('handles windows-style separators', () => {
		expect(validate_desktop_folder_path('C:\\Users\\me\\Desk', 'C:\\Users\\me', [])).toBeNull()
		expect(validate_desktop_folder_path('D:\\desk', 'C:\\Users\\me', [])).toMatch(/home folder/)
	})
})

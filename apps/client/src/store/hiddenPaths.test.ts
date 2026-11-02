import { afterEach, describe, expect, test, vi } from 'vitest'
import {
	add_hidden_path,
	display_hidden_path,
	hidden_paths,
	is_user_hidden_path,
	parse_hidden_path,
	paths_ignore_case,
	remove_hidden_path,
} from './hiddenPaths'

const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
const LINUX = 'Mozilla/5.0 (X11; Linux x86_64)'

afterEach(() => {
	hidden_paths.value = []
	vi.unstubAllGlobals()
})

describe('parse_hidden_path', () => {
	test('expands ~ and accepts only an absolute path otherwise', () => {
		expect(parse_hidden_path('  ~/Library/ ', '/Users/a')).toBe('/Users/a/Library')
		expect(parse_hidden_path('~', '/Users/a')).toBe('/Users/a')
		expect(parse_hidden_path('~/', '/Users/a')).toBe('/Users/a')
		expect(parse_hidden_path('~/Library', null)).toBeNull()
		expect(parse_hidden_path('Library', '/Users/a')).toBeNull()
		expect(parse_hidden_path('~foo', '/Users/a')).toBeNull()
		expect(parse_hidden_path('/Users/a/Library/', null)).toBe('/Users/a/Library')
		expect(parse_hidden_path('C:\\Users\\a\\Library\\', null)).toBe('C:\\Users\\a\\Library')
		expect(parse_hidden_path('~/Library/Caches', 'C:\\Users\\a')).toBe('C:\\Users\\a\\Library\\Caches')
	})
})

describe('paths_ignore_case', () => {
	test('folds case on Mac and Windows only', () => {
		expect(paths_ignore_case(MAC)).toBe(true)
		expect(paths_ignore_case(WINDOWS)).toBe(true)
		expect(paths_ignore_case(LINUX)).toBe(false)
	})
})

describe('add_hidden_path', () => {
	test('stores the absolute path and skips a repeat', () => {
		expect(add_hidden_path('~/Library', '/Users/a')).toBe('added')
		expect(hidden_paths.value).toEqual(['/Users/a/Library'])
		expect(add_hidden_path('~/Library', '/Users/a')).toBe('duplicate')
		expect(add_hidden_path('notes', '/Users/a')).toBe('invalid')
		expect(hidden_paths.value).toEqual(['/Users/a/Library'])
	})

	test('on Mac a different case is the same path and does not hide children', () => {
		vi.stubGlobal('navigator', { userAgent: MAC })
		expect(add_hidden_path('~/Library', '/Users/a')).toBe('added')
		expect(add_hidden_path('/users/a/library', null)).toBe('duplicate')
		expect(is_user_hidden_path('/Users/a/LIBRARY')).toBe(true)
		expect(is_user_hidden_path('/Users/a/Library/Caches')).toBe(false)
		remove_hidden_path('/users/a/library')
		expect(hidden_paths.value).toEqual([])
	})

	test('on Windows slashes and case are the same path', () => {
		vi.stubGlobal('navigator', { userAgent: WINDOWS })
		expect(add_hidden_path('~/Library', 'C:\\Users\\a')).toBe('added')
		expect(hidden_paths.value).toEqual(['C:\\Users\\a\\Library'])
		expect(is_user_hidden_path('C:/Users/a/library')).toBe(true)
		expect(display_hidden_path('C:\\Users\\a\\Library', 'C:\\Users\\a')).toBe('~/Library')
	})

	test('on Linux case is distinct', () => {
		vi.stubGlobal('navigator', { userAgent: LINUX })
		expect(add_hidden_path('~/Library', '/home/a')).toBe('added')
		expect(add_hidden_path('~/library', '/home/a')).toBe('added')
		expect(hidden_paths.value).toEqual(['/home/a/Library', '/home/a/library'])
		expect(is_user_hidden_path('/home/a/Library')).toBe(true)
		expect(is_user_hidden_path('/home/a/LIBRARY')).toBe(false)
	})

	test('on the web ~ stays unresolved and an absolute path can still be added', () => {
		expect(add_hidden_path('~/Library', null)).toBe('invalid')
		expect(add_hidden_path('/Users/a/Library', null)).toBe('added')
		expect(hidden_paths.value).toEqual(['/Users/a/Library'])
	})
})

describe('display_hidden_path', () => {
	test('abbreviates a path under home', () => {
		expect(display_hidden_path('/Users/a/Library', '/Users/a', false)).toBe('~/Library')
		expect(display_hidden_path('/Users/a', '/Users/a', false)).toBe('~')
		expect(display_hidden_path('/opt/data', '/Users/a', false)).toBe('/opt/data')
		expect(display_hidden_path('/Users/a/Library', '/Users/A', true)).toBe('~/Library')
		expect(display_hidden_path('/Users/a/Library', '/Users/A', false)).toBe('/Users/a/Library')
		expect(display_hidden_path('/Users/a/Library', null, false)).toBe('/Users/a/Library')
	})
})

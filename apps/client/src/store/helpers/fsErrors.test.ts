import { describe, expect, test } from 'vitest'
import { is_missing_path_error, is_permission_denied_error } from './fsErrors'

describe('fs errors', () => {
	test('macOS EPERM on a protected folder reads as permission denied', () => {
		expect(is_permission_denied_error(new Error('Operation not permitted (os error 1)'))).toBe(true)
		expect(is_permission_denied_error('Failed to read dir: os error 1')).toBe(true)
		expect(is_permission_denied_error('operation not permitted')).toBe(true)
		expect(is_permission_denied_error(new Error('No such file or directory (os error 2)'))).toBe(false)
		expect(is_permission_denied_error(new Error('Permission denied (os error 13)'))).toBe(false)
		expect(is_missing_path_error(new Error('Operation not permitted (os error 1)'))).toBe(false)
	})

	test('a folder moved in Finder reads as missing, not as a toast', () => {
		expect(is_missing_path_error(new Error('No path was found. about ["/Users/amatyukh/ai/Варианты планов"]'))).toBe(true)
		expect(is_missing_path_error(new Error('No such file or directory (os error 2)'))).toBe(true)
	})
})

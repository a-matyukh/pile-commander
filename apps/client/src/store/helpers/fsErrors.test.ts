import { describe, expect, test } from 'vitest'
import { is_interrupted_error, is_missing_path_error, is_permission_denied_error, is_protected_path_error } from './fsErrors'

describe('fs errors', () => {
	test('a write the desktop app refuses by its own rule is told apart from an OS error', () => {
		// plugin-fs, release and debug wording
		expect(is_protected_path_error('forbidden path: /Users/ann/Library/LaunchAgents/a.plist')).toBe(true)
		expect(is_protected_path_error(new Error('forbidden path: /Users/ann/.zshrc, maybe it is not allowed on the scope for `allow-write-file` permission in your capability file'))).toBe(true)
		// the app's own commands (src-tauri/src/paths.rs)
		expect(is_protected_path_error('protected folder: Pile Commander does not change “/Users/ann/.ssh/config”')).toBe(true)
		expect(is_protected_path_error(new Error('Operation not permitted (os error 1)'))).toBe(false)
		expect(is_protected_path_error(new Error('"a.txt" already exists in this folder'))).toBe(false)
	})

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

describe('a request the browser cut off', () => {
	test('an aborted or dropped fetch is an interruption, a refusal is not', () => {
		expect(is_interrupted_error(new Error('resolve failed: /Note 1.md (AbortError: Fetch is aborted)'))).toBe(true)
		expect(is_interrupted_error(new TypeError('Failed to fetch'))).toBe(true)
		expect(is_interrupted_error(new TypeError('Load failed'))).toBe(true)
		expect(is_interrupted_error(new Error('permission denied for table entries'))).toBe(false)
		expect(is_interrupted_error(new Error('No such file or directory'))).toBe(false)
	})
})

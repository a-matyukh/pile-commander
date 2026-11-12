import { describe, expect, test } from 'vitest'
import { moved_away_link, moved_root, moved_state, new_sync_state, other_copy_link, parse_sync_state, take_over_state } from './stateFile'

const ROOT = '/Users/me/Desktop/Folder views'
const ME = 'user-me'
const HERE = 'device-here'
const THERE = 'device-there'
const WS = 'ws-folder-views'

function file_from(device_id: string, over: Record<string, unknown> = {}) {
	const state = new_sync_state({ root_path: ROOT, device_id, user_id: ME, workspace_id: WS })
	state.entries = { 'note.md': { kind: 'file', size: 3, mtime_ms: 1, cloud_id: 'c1', cloud_modified_at: 't', xattrs: {} } } as never
	return JSON.stringify({ ...state, ...over })
}

describe('a folder synced from another copy of the app', () => {
	test('another copy\'s link file for this account and this very folder is found', () => {
		expect(other_copy_link(file_from(THERE), { root_path: ROOT, user_id: ME, device_id: HERE }))
			.toEqual({ workspace_id: WS, device_id: THERE })
	})

	test('this copy\'s own file, another account, or a folder copied from elsewhere: never', () => {
		const here = { root_path: ROOT, user_id: ME, device_id: HERE }
		expect(other_copy_link(file_from(HERE), here)).toBeNull()
		expect(other_copy_link(file_from(THERE, { user_id: 'someone-else' }), here)).toBeNull()
		expect(other_copy_link(file_from(THERE, { root_path: '/Users/me/Desktop/elsewhere' }), here)).toBeNull()
		expect(other_copy_link('not json', here)).toBeNull()
		expect(other_copy_link(JSON.stringify({ version: 2 }), here)).toBeNull()
	})

	test('continuing here keeps the base snapshot and makes the file this copy\'s', () => {
		const owner = { root_path: ROOT, device_id: HERE, user_id: ME, workspace_id: WS }
		const taken = take_over_state(file_from(THERE), owner, THERE)
		expect(taken?.device_id).toBe(HERE)
		expect(Object.keys(taken?.entries ?? {})).toEqual(['note.md'])
		// this copy now reads it as its own; the other copy no longer does
		const written = JSON.stringify(taken)
		expect(parse_sync_state(written, owner)).not.toBeNull()
		expect(parse_sync_state(written, { ...owner, device_id: THERE })).toBeNull()
	})
})

describe('a synced folder the app moves or renames', () => {
	test('the folder itself, or one inside a moved parent, follows; others stay', () => {
		expect(moved_root(ROOT, ROOT, '/Users/me/Projects/Folder views')).toBe('/Users/me/Projects/Folder views')
		expect(moved_root(ROOT, '/Users/me/Desktop', '/Users/me/Archive')).toBe('/Users/me/Archive/Folder views')
		expect(moved_root(ROOT, '/Users/me/Desktop/Folder', '/Users/me/X')).toBeNull()
		expect(moved_root(ROOT, '/Users/me/Desktop/Folder views/inner', '/Users/me/X')).toBeNull()
	})

	test('the link file keeps its base snapshot at the new path, and only this link\'s file moves', () => {
		const owner = { root_path: ROOT, device_id: HERE, user_id: ME, workspace_id: WS }
		const to = '/Users/me/Projects/Folder views'
		const moved = moved_state(file_from(HERE), owner, to)
		expect(moved?.root_path).toBe(to)
		expect(Object.keys(moved?.entries ?? {})).toEqual(['note.md'])
		expect(parse_sync_state(JSON.stringify(moved), { ...owner, root_path: to })).not.toBeNull()
		expect(moved_state(file_from(THERE), owner, to)).toBeNull()
	})
})

describe('a synced folder moved outside the app', () => {
	const here = { root_path: '/Users/me/Projects/Folder views', user_id: ME, device_id: HERE }

	test('this copy\'s link file at another path names the old place', () => {
		expect(moved_away_link(file_from(HERE), here)).toEqual({ workspace_id: WS, root_path: ROOT })
	})

	test('the same place, another copy of the app, another account, or no link file: never', () => {
		expect(moved_away_link(file_from(HERE), { ...here, root_path: ROOT })).toBeNull()
		expect(moved_away_link(file_from(THERE), here)).toBeNull()
		expect(moved_away_link(file_from(HERE, { user_id: 'someone-else' }), here)).toBeNull()
		expect(moved_away_link('not json', here)).toBeNull()
	})
})

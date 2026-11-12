import { describe, expect, test } from 'vitest'
import { old_copy_verdict } from './joinedCopy'
import { new_sync_state } from './stateFile'
import type { CloudEntry } from './types'

const row = (path: string, id: string, kind: 'file' | 'folder' = 'file', modified_at: string | null = 't1'): CloudEntry => ({
	id, parent_id: null, path, name: path.slice(path.lastIndexOf('/') + 1), kind, size: 1, modified_at, is_blob: false, xattrs: {},
})

function synced() {
	const state = new_sync_state({ root_path: '/me/sync test', device_id: 'd', user_id: 'u', workspace_id: 'w' })
	state.entries = {
		'notes': { kind: 'folder', size: 0, mtime_ms: 0, cloud_id: 'c-notes', cloud_modified_at: 'f' },
		'notes/a.md': { kind: 'file', size: 1, mtime_ms: 1, cloud_id: 'c-a', cloud_modified_at: 't1' },
	}
	const cloud = [row('/', 'c-root', 'folder'), row('/notes', 'c-notes', 'folder', 'f2'), row('/notes/a.md', 'c-a')]
	return { state, cloud }
}

const safe = { owner: true, shared: false, published: false, other_computers: 0 }

describe('the old cloud copy of a synced folder that joined another', () => {
	test('nothing anyone else relies on, and nothing new in the cloud: to the trash', () => {
		// a folder's own timestamp moving is not a change of content
		expect(old_copy_verdict({ ...safe, ...synced() })).toBe('trash')
	})

	test('kept when someone else relies on it, first reason first', () => {
		const { state, cloud } = synced()
		expect(old_copy_verdict({ ...safe, owner: false, shared: true, state, cloud })).toBe('not_owner')
		expect(old_copy_verdict({ ...safe, shared: true, published: true, state, cloud })).toBe('shared')
		expect(old_copy_verdict({ ...safe, published: true, state, cloud })).toBe('published')
		expect(old_copy_verdict({ ...safe, other_computers: 1, state, cloud })).toBe('other_computers')
	})

	test('kept when the cloud holds what this Mac never got', () => {
		const changed = synced()
		changed.cloud[2] = row('/notes/a.md', 'c-a', 'file', 't2')
		expect(old_copy_verdict({ ...safe, ...changed })).toBe('cloud_changes')
		const added = synced()
		added.cloud.push(row('/notes/new.md', 'c-new'))
		expect(old_copy_verdict({ ...safe, ...added })).toBe('cloud_changes')
	})

	test('kept when it cannot tell', () => {
		expect(old_copy_verdict({ ...safe, state: null, cloud: [] })).toBe('unknown')
		expect(old_copy_verdict({ ...safe, state: synced().state, cloud: null })).toBe('unknown')
	})
})

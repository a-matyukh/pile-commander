import { afterEach, describe, expect, test } from 'vitest'
import { is_desktop } from '@/isDesktop'
import cloud from '@/store/cloud'
import { share_items, shows_synced, synced_tip, trash_sync_note, trash_sync_note_for_many } from './share'

const folder = { drive_id: 'cloud' as const, root_id: 'ws-1', folder_id: '/nested' }

afterEach(() => {
	cloud.roles = {}
	cloud.synced_on = {}
})

describe('share_items', () => {
	test('on the web a cloud folder can be exported; share and publish stay with the owner', () => {
		expect(is_desktop).toBe(false)
		cloud.roles = { 'ws-1': 'viewer' }
		expect(share_items(folder)).toEqual({ export: true, share_with: false, publish: false })
		cloud.roles = { 'ws-1': 'editor' }
		expect(share_items(folder)).toEqual({ export: true, share_with: false, publish: false })
		cloud.roles = { 'ws-1': 'owner' }
		expect(share_items(folder)).toEqual({ export: true, share_with: true, publish: true })
	})
})

describe('synced on another computer', () => {
	const root = { drive_id: 'cloud' as const, root_id: 'ws-1', folder_id: '/' }

	test('the web shows a cloud folder a computer syncs, with how many and when', () => {
		expect(shows_synced(root)).toBe(false)
		cloud.synced_on = { 'ws-1': { last_pass_at: Date.now() - 5 * 60_000, devices: 1 } }
		expect(shows_synced(root)).toBe(true)
		expect(synced_tip(root)).toBe('Synced with a computer · 5 min ago')
		cloud.synced_on = { 'ws-1': { last_pass_at: Date.now(), devices: 2 } }
		expect(synced_tip(root)).toBe('Synced with 2 computers · just now')
	})

	test('only the top level of a cloud folder syncs', () => {
		cloud.synced_on = { 'ws-1': { last_pass_at: Date.now(), devices: 1 } }
		expect(shows_synced({ ...root, folder_id: '/nested' })).toBe(false)
		expect(shows_synced({ ...root, root_id: 'ws-2' })).toBe(false)
	})
})

describe('trash_sync_note', () => {
	const root = { drive_id: 'cloud' as const, root_id: 'ws-1', folder_id: '/' }

	test('a cloud folder no computer syncs says nothing', () => {
		expect(trash_sync_note(root)).toBeNull()
		expect(trash_sync_note({ ...root, folder_id: '/nested' })).toBeNull()
	})

	test('the top level of a synced cloud folder: only the cloud copy goes', () => {
		cloud.synced_on = { 'ws-1': { last_pass_at: Date.now(), devices: 1 } }
		expect(trash_sync_note(root)).toEqual({
			text: 'Only the cloud copy is removed. The folders synced with it on other computers stay as they are.',
			also_there: false,
		})
	})

	test('a folder inside a synced cloud folder: the sync removes it on the computers too', () => {
		cloud.synced_on = { 'ws-1': { last_pass_at: Date.now(), devices: 1 } }
		expect(trash_sync_note({ ...root, folder_id: '/nested' })).toEqual({
			text: 'The sync removes it on the other computers that sync this folder too, to their trash.',
			also_there: true,
		})
	})

	test('a file, and several items at once, inside a synced cloud folder', () => {
		cloud.synced_on = { 'ws-1': { last_pass_at: Date.now(), devices: 1 } }
		expect(trash_sync_note({ ...root, folder_id: '/a.md' }, 'file')?.also_there).toBe(true)
		expect(trash_sync_note_for_many([
			{ ...root, folder_id: '/a.md' },
			{ ...root, folder_id: '/b' },
		])).toEqual({
			text: 'The sync removes them on the other computers that sync this folder too, to their trash.',
			also_there: true,
		})
		expect(trash_sync_note_for_many([{ ...root, root_id: 'ws-2', folder_id: '/a.md' }])).toBeNull()
	})
})

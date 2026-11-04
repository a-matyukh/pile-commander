import { afterEach, describe, expect, test } from 'vitest'
import { is_desktop } from '@/isDesktop'
import cloud from '@/store/cloud'
import { share_items, shows_synced, synced_tip } from './share'

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

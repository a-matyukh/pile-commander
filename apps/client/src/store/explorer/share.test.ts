import { afterEach, describe, expect, test } from 'vitest'
import { is_desktop } from '@/isDesktop'
import cloud from '@/store/cloud'
import { share_items } from './share'

const folder = { drive_id: 'cloud' as const, root_id: 'ws-1', folder_id: '/nested' }

afterEach(() => {
	cloud.roles = {}
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

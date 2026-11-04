import { afterEach, describe, expect, test, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import type { SyncLink } from '@/store/localSync'
import cloud from '@/store/cloud'
import bridge, { close_bridge } from '@/store/bridge'
import { close_share_publish, share_publish } from '@/store/explorer/sharePublishPanel'
import { explorer_language } from '@/store/explorer/language'
import { format_bytes } from '@/utils/format_bytes'

const links = vi.hoisted(() => ({ value: {} as Record<string, SyncLink> }))

vi.mock('@/store/localSync', () => ({
	sync_link_of: (root: string) => links.value[root] ?? null,
	synced_folder_of: (workspace_id: string, user_id?: string) =>
		Object.values(links.value).find(link => link.workspace_id === workspace_id && link.user_id === user_id) ?? null,
	sync_now: vi.fn(),
	sync_workspace_to_folder: vi.fn(),
	unlink_folder: vi.fn(),
}))

import { open_shared_cloud } from './share'

function link(root: string, user_id: string, workspace_id = 'ws-1'): SyncLink {
	return { root, name: 'Notes', workspace_id, user_id }
}

const notes = { drive_id: 'local' as const, root_id: '/Notes', folder_id: '/Notes' }
const board = { drive_id: 'local' as const, root_id: '/Notes', folder_id: '/Notes/board' }

afterEach(() => {
	links.value = {}
	cloud.user = null
	close_share_publish()
	if (bridge.step === 'copying') bridge.step = 'summary'
	close_bridge()
	bridge.door = 'list'
	bridge.source = null
	bridge.share_target = null
	explorer_language.value = 'system'
})

describe('open_shared_cloud', () => {
	test('a synced folder opens the cloud panel and does not start a copy', () => {
		cloud.user = { id: 'me' } as User
		links.value = { '/Notes': link('/Notes', 'me') }
		open_shared_cloud(notes, 'Notes', 'people')
		expect(share_publish).toMatchObject({ open: true, window: 'people', workspace_id: 'ws-1' })
		expect(bridge.open).toBe(false)
		expect(bridge.door).not.toBe('share')
	})

	test('a subfolder of a synced folder opens the same cloud folder', () => {
		cloud.user = { id: 'me' } as User
		links.value = { '/Notes': link('/Notes', 'me') }
		open_shared_cloud(board, 'board', 'people')
		expect(share_publish).toMatchObject({ open: true, window: 'people', workspace_id: 'ws-1', folder_name: 'Notes' })
		expect(bridge.open).toBe(false)
	})

	test('a folder that is not synced starts a share copy', () => {
		cloud.user = { id: 'me' } as User
		open_shared_cloud(notes, 'Notes', 'people')
		expect(share_publish.open).toBe(false)
		expect(bridge.open).toBe(true)
		expect(bridge.door).toBe('share')
		expect(bridge.share_target).toBe('people')
		expect(bridge.source?.id).toBe('/Notes')
	})

	test('publishing on the Hub from an unsynced folder copies with a publish door and the hub window', () => {
		cloud.user = { id: 'me' } as User
		open_shared_cloud(notes, 'Notes', 'hub')
		expect(bridge.door).toBe('publish')
		expect(bridge.share_target).toBe('hub')
	})

	test('another account’s link on this device still copies', () => {
		cloud.user = { id: 'me' } as User
		links.value = { '/Notes': link('/Notes', 'someone-else') }
		open_shared_cloud(board, 'board', 'people')
		expect(share_publish.open).toBe(false)
		expect(bridge.door).toBe('share')
	})
})

describe('format_bytes', () => {
	test('uses the interface language for units and the decimal mark', () => {
		explorer_language.value = 'en'
		expect(format_bytes(0)).toBe('0 B')
		expect(format_bytes(1536)).toBe('1.5 KB')

		explorer_language.value = 'ru'
		expect(format_bytes(0)).toBe('0 Б')
		expect(format_bytes(1536)).toBe('1,5 КБ')
		expect(format_bytes(5 * 1024 * 1024)).toBe('5,0 МБ')
	})
})

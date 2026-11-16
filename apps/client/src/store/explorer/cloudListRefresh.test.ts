import { afterEach, describe, expect, test, vi } from 'vitest'
import cloud from '@/store/cloud'
import { notify_cloud_workspaces_synced } from '@/store/workspaces_list'
import { refresh_cloud_list } from './drives'

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
	cloud.user = null
})

describe('refresh_cloud_list: the cloud list is read again later, not on every move', () => {
	test('signed out, or before the first list: nothing is read', async () => {
		const read = vi.spyOn(cloud, 'fetch_workspaces').mockImplementation(async () => {})
		await refresh_cloud_list()
		expect(read).not.toHaveBeenCalled()
	})

	test('after the first list: read again, then not again within ten seconds', async () => {
		vi.useFakeTimers({ toFake: ['Date'] })
		vi.setSystemTime(new Date('2026-11-16T12:00:00Z'))
		const read = vi.spyOn(cloud, 'fetch_workspaces').mockImplementation(async () => {})
		cloud.user = { id: 'me' } as typeof cloud.user
		notify_cloud_workspaces_synced()

		await refresh_cloud_list()
		await refresh_cloud_list()
		expect(read).toHaveBeenCalledTimes(1)
		vi.setSystemTime(new Date('2026-11-16T12:00:11Z'))
		await refresh_cloud_list()
		expect(read).toHaveBeenCalledTimes(2)
	})
})

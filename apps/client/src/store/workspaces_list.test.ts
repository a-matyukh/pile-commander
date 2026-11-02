import { describe, expect, test, vi } from 'vitest'
import {
	notify_cloud_workspaces_synced,
	on_cloud_workspaces_synced,
	register_cloud_workspaces_refetch,
	request_cloud_workspaces_refetch,
} from './workspaces_list'

describe('cloud workspaces sync wiring', () => {
	test('refetch registry delegates to the registered callback', () => {
		const cb = vi.fn()
		register_cloud_workspaces_refetch(cb)
		request_cloud_workspaces_refetch()
		expect(cb).toHaveBeenCalledTimes(1)
	})

	test('sync listeners fire when a fetch finishes and unsubscribe', () => {
		const listener = vi.fn()
		const off = on_cloud_workspaces_synced(listener)
		notify_cloud_workspaces_synced()
		expect(listener).toHaveBeenCalledTimes(1)
		off()
		notify_cloud_workspaces_synced()
		expect(listener).toHaveBeenCalledTimes(1)
	})
})

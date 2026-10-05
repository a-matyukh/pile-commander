import { describe, expect, test, vi } from 'vitest'
import type { WorkspacesList } from '@/domain/WorkspacesList'
import {
	filter_existing_local_workspaces,
	filter_existing_workspaces,
	on_cloud_workspaces_synced,
	register_cloud_workspaces_refetch,
	request_cloud_workspaces_refetch,
	sync_cloud_workspaces_list,
} from './workspaces_list'

describe('filter_existing_local_workspaces', () => {
	const list: WorkspacesList = [
		{ type: 'local', id: '/Users/me/projects/a', name: 'a' },
		{ type: 'local', id: '/Users/me/projects/b/', name: 'b' },
		{ type: 'demo', id: '/demo', name: 'Demo' },
		{ type: 'cloud', id: 'cloud-1', name: 'Cloud' },
	]

	test('keeps non-local entries and existing local folders', async () => {
		const exists = async (path: string) => path === '/Users/me/projects/a'

		const filtered = await filter_existing_local_workspaces(list, exists)

		expect(filtered).toEqual([
			{ type: 'local', id: '/Users/me/projects/a', name: 'a' },
			{ type: 'demo', id: '/demo', name: 'Demo' },
			{ type: 'cloud', id: 'cloud-1', name: 'Cloud' },
		])
	})

	test('normalizes local ids while filtering', async () => {
		const exists = async (path: string) => path === '/Users/me/projects/b'

		const filtered = await filter_existing_local_workspaces(list, exists)

		expect(filtered).toEqual([
			{ type: 'local', id: '/Users/me/projects/b', name: 'b' },
			{ type: 'demo', id: '/demo', name: 'Demo' },
			{ type: 'cloud', id: 'cloud-1', name: 'Cloud' },
		])
	})
})

describe("cloud workspaces sync wiring", () => {
	test("refetch registry delegates to the registered callback", () => {
		const cb = vi.fn()
		register_cloud_workspaces_refetch(cb)
		request_cloud_workspaces_refetch()
		expect(cb).toHaveBeenCalledTimes(1)
	})

	test("sync listeners fire on sync_cloud_workspaces_list and unsubscribe", () => {
		const listener = vi.fn()
		const off = on_cloud_workspaces_synced(listener)
		sync_cloud_workspaces_list(new Set())
		expect(listener).toHaveBeenCalledTimes(1)
		off()
		sync_cloud_workspaces_list(new Set())
		expect(listener).toHaveBeenCalledTimes(1)
	})
})

describe('filter_existing_workspaces', () => {
	const gone = '/browser-desktops/desk-1/New folder 1'
	const list: WorkspacesList = [
		{ type: 'browser', id: gone, name: 'New folder 1' },
		{ type: 'browser', id: '/browser-desktops/desk-1/docs', name: 'docs' },
		{ type: 'demo', id: '/demo', name: 'Demo' },
		{ type: 'cloud', id: 'cloud-1', name: 'Cloud' },
	]

	test('drops browser folders that are gone from IndexedDB', async () => {
		const filtered = await filter_existing_workspaces(list, {
			browser: async path => path !== gone,
		})

		expect(filtered).toEqual([
			{ type: 'browser', id: '/browser-desktops/desk-1/docs', name: 'docs' },
			{ type: 'demo', id: '/demo', name: 'Demo' },
			{ type: 'cloud', id: 'cloud-1', name: 'Cloud' },
		])
	})

	test('keeps browser folders when no browser checker is provided', async () => {
		const filtered = await filter_existing_workspaces(list, {})
		expect(filtered).toEqual(list)
	})
})

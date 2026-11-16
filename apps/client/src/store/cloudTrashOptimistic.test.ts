import { afterEach, describe, expect, test, vi } from 'vitest'

const rpc = vi.hoisted(() => ({
	trash: vi.fn(async (_client: unknown, _id: string) => {}),
	restore: vi.fn(async (_client: unknown, _id: string) => {}),
}))

vi.mock('@pile-commander/file-manager', async (original) => ({
	...(await original<typeof import('@pile-commander/file-manager')>()),
	trash_workspace: rpc.trash,
	restore_workspace: rpc.restore,
}))
vi.mock('@/services/cloud/client', async (original) => ({
	...(await original<typeof import('@/services/cloud/client')>()),
	require_supabase: () => ({}),
}))

const { default: cloud } = await import('./cloud')
const { on_cloud_workspace_trash_changed } = await import('./workspaces_list')

const list = () => [
	{ type: 'cloud' as const, id: 'a', name: 'A' },
	{ type: 'cloud' as const, id: 'b', name: 'B' },
	{ type: 'cloud' as const, id: 'c', name: 'C' },
]

afterEach(() => {
	vi.restoreAllMocks()
	cloud.workspaces = []
	cloud.last_error = null
})

describe('cloud.trash: the folder leaves at once, the cloud is told behind it', () => {
	test('gone from the list before the cloud answers; a synced folder hears it once the cloud took it', async () => {
		cloud.workspaces = list()
		vi.spyOn(cloud, 'fetch_workspaces').mockImplementation(async () => {})
		let answer: () => void = () => {}
		rpc.trash.mockImplementationOnce(() => new Promise<void>(resolve => { answer = resolve }))
		const heard: string[] = []
		const stop = on_cloud_workspace_trash_changed(id => heard.push(id))

		const trashing = cloud.trash('b')
		expect(cloud.workspaces.map(ws => ws.id)).toEqual(['a', 'c'])
		expect(heard).toEqual([])
		answer()
		await trashing
		expect(heard).toEqual(['b'])
		expect(cloud.last_error).toBeNull()
		stop()
	})

	test('a refusal puts it back where it was, and nobody hears of a trash', async () => {
		cloud.workspaces = list()
		vi.spyOn(cloud, 'fetch_workspaces').mockImplementation(async () => {})
		rpc.trash.mockImplementationOnce(async () => { throw new Error('offline') })
		const heard: string[] = []
		const stop = on_cloud_workspace_trash_changed(id => heard.push(id))

		await cloud.trash('b')
		expect(cloud.workspaces.map(ws => ws.id)).toEqual(['a', 'b', 'c'])
		expect(cloud.last_error).toBe('offline')
		expect(heard).toEqual([])
		stop()
	})

	test('a restore is heard too', async () => {
		vi.spyOn(cloud, 'fetch_workspaces').mockImplementation(async () => {})
		const heard: string[] = []
		const stop = on_cloud_workspace_trash_changed(id => heard.push(id))
		expect(await cloud.restore_trashed_workspace('b')).toBe(true)
		expect(heard).toEqual(['b'])
		stop()
	})
})

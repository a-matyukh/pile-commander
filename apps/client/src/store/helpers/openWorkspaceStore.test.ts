import { describe, expect, it, vi } from 'vitest'
import { createFakeFileManager, createMemoryBrowserStorage, type WorkspaceAccess } from '@pile-commander/file-manager'
import { open_workspace_store } from './openWorkspaceStore'

const storage = vi.hoisted(() => ({
	current: null as ReturnType<typeof createMemoryBrowserStorage> | null,
}))

// cloud workspaces: a fake fm stands in for the supabase-backed one and the
// membership check answers whatever the test sets
const cloud = vi.hoisted(() => ({
	fake: null as ReturnType<typeof createFakeFileManager> | null,
	access: null as WorkspaceAccess | null | Error,
	session: null as { user: { id: string } } | null,
	block_supabase: false,
	access_calls: 0,
}))

vi.mock('@/services/desktop/browserDesktopFolders', () => ({
	require_browser_storage: () => {
		if (!storage.current) throw new Error('Browser storage (IndexedDB) is unavailable in this browser')
		return storage.current
	},
}))

vi.mock('@pile-commander/file-manager', async (importOriginal) => ({
	...await importOriginal<typeof import('@pile-commander/file-manager')>(),
	createCloudFileManager: () => cloud.fake!.fm,
	get_workspace_access: async () => {
		cloud.access_calls++
		if (cloud.access instanceof Error) throw cloud.access
		return cloud.access
	},
	createFileManager: () => {
		if (!cloud.fake) throw new Error('createFileManager: no fake')
		return cloud.fake.fm
	},
}))

vi.mock('@/services/cloud/client', async (importOriginal) => ({
	...await importOriginal<typeof import('@/services/cloud/client')>(),
	require_supabase: () => {
		if (cloud.block_supabase) throw new Error('supabase should not be used')
		return {
			auth: {
				getSession: async () => ({ data: { session: cloud.session } }),
			},
		}
	},
}))

describe('open_workspace_store: browser workspaces', () => {
	it('opens a browser workspace rooted at item.id with write access', async () => {
		storage.current = createMemoryBrowserStorage()
		await storage.current.apply({
			entries: [{ path: '/browser-desktops/d1', type: 'folder', xattrs: {} }],
		})

		const workspace = await open_workspace_store({
			id: '/browser-desktops/d1',
			type: 'browser',
			name: 'Main',
		})

		expect(workspace.id).toBe('/browser-desktops/d1')
		expect(workspace.can_write).toBe(true)
		expect(workspace.opened_folder_id).toBe('/browser-desktops/d1')
	})

	it('throws a clear error when IndexedDB is unavailable', async () => {
		storage.current = null

		await expect(open_workspace_store({
			id: '/browser-desktops/d1',
			type: 'browser',
			name: 'Main',
		})).rejects.toThrow(/IndexedDB/)
	})
})

describe('open_workspace_store: public link visitors', () => {
	/** Opens the board by its public URL and loads the canvas of its root. */
	async function open_public(access: WorkspaceAccess | null | Error) {
		const fake = createFakeFileManager()
		fake.seed_folder('/')
		cloud.fake = fake
		cloud.access = access

		const workspace = await open_workspace_store(
			{ id: 'ws-1', type: 'cloud', name: 'Board' },
			{ public_readonly: true },
		)
		await workspace.ensure_strokes('/')
		await workspace.ensure_connections('/')
		return { workspace, methods: fake.calls.map(call => call.method) }
	}

	it('a visitor without membership reads the board once, with no realtime', async () => {
		const { workspace, methods } = await open_public(null)

		expect(workspace.can_write).toBe(false)
		expect(workspace.live).toBe(false)
		expect(methods.filter(method => method.startsWith('watch'))).toEqual([])
		expect(methods).toContain('list_strokes')
		expect(methods).toContain('list_connections')
	})

	it.each(['owner', 'editor', 'viewer'] as const)(
		'a member (%s) gets live updates in the read-only public view',
		async (access) => {
			const { workspace, methods } = await open_public(access)

			expect(workspace.can_write).toBe(false)
			expect(workspace.live).toBe(true)
			expect(methods).toContain('watch')
			expect(methods).toContain('watch_strokes')
			expect(methods).toContain('watch_connections')
		},
	)

	it('a failed membership check leaves the view static instead of failing', async () => {
		const { workspace, methods } = await open_public(new Error('network down'))

		expect(workspace.can_write).toBe(false)
		expect(workspace.live).toBe(false)
		expect(methods.filter(method => method.startsWith('watch'))).toEqual([])
	})
})

describe('open_workspace_store: local workspaces', () => {
	it('opens from the file manager without calling supabase', async () => {
		const fake = createFakeFileManager()
		fake.seed_folder('/tmp/pile')
		cloud.fake = fake
		cloud.block_supabase = true
		const calls = cloud.access_calls
		try {
			const workspace = await open_workspace_store({
				id: '/tmp/pile',
				type: 'local',
				name: 'Pile',
			})
			expect(workspace.id).toBe('/tmp/pile')
			expect(workspace.can_write).toBe(true)
			expect(workspace.opened_folder_id).toBe('/tmp/pile')
			expect(cloud.access_calls).toBe(calls)
		} finally {
			cloud.block_supabase = false
		}
	})
})

describe('open_workspace_store: cloud without a connection', () => {
	const item = { id: 'ws-1', type: 'cloud' as const, name: 'Board' }

	it('says the workspace needs a connection when the membership check cannot reach the network', async () => {
		cloud.fake = createFakeFileManager()
		cloud.access = new TypeError('Failed to fetch')
		cloud.session = null
		await expect(open_workspace_store(item)).rejects.toThrow(
			'This cloud workspace needs a connection.',
		)
	})

	it('says the workspace needs a connection when there is no session', async () => {
		cloud.fake = createFakeFileManager()
		cloud.access = null
		cloud.session = null
		await expect(open_workspace_store(item)).rejects.toThrow(
			'This cloud workspace needs a connection.',
		)
	})

	it('keeps the no-access error when a session is present', async () => {
		cloud.fake = createFakeFileManager()
		cloud.access = null
		cloud.session = { user: { id: 'user-1' } }
		await expect(open_workspace_store(item)).rejects.toThrow(/No access to workspace/)
	})
})

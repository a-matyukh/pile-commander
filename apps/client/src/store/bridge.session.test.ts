import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { User } from '@supabase/supabase-js'
import type { FileManager } from '@pile-commander/file-manager'
import type { BridgePreflight } from '@/services/cloud/bridge/preflight'
import { explorer_language } from '@/store/explorer/language'
import cloud from '@/store/cloud'
import { bridge_hidden_tip, bridge_panel_view, BRIDGE_DONE_MS } from '@/store/bridgePanel'

const preflight_tree = vi.hoisted(() => vi.fn())
const run_bridge = vi.hoisted(() => vi.fn())
const link_folder = vi.hoisted(() => vi.fn(async () => {}))

vi.mock('@/services/cloud/bridge/preflight', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/cloud/bridge/preflight')>()
	return { ...actual, preflight_tree }
})

vi.mock('@/services/cloud/bridge/runBridge', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/cloud/bridge/runBridge')>()
	return { ...actual, run_bridge }
})

vi.mock('@/store/localSync', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/store/localSync')>()
	return { ...actual, link_folder }
})

import bridge, {
	cancel_copy as cancel,
	close_bridge as close,
	dismiss_bridge as dismiss,
	open_bridge as open,
	set_open_cloud_copy as set_open,
	set_resume_folder as set_resume,
	start_copy as start,
} from '@/store/bridge'

const fetch_plan = cloud.fetch_plan.bind(cloud)
const fetch_workspaces = cloud.fetch_workspaces.bind(cloud)

const origin = { drive_id: 'local', root_id: '/Users/me', folder_id: '/Users/me/Notes' }
const source = { type: 'local' as const, id: '/Users/me/Notes', name: 'Notes' }

function sample(): BridgePreflight {
	const note = {
		id: '/Users/me/Notes/a.txt',
		relative: 'a.txt',
		name: 'a.txt',
		size_bytes: 10,
		mime: 'text/plain',
		kind: 'text' as const,
		over_file_limit: false,
		bad_name: false,
		text_as_blob: false,
	}
	return {
		folders: [],
		files: [note],
		total_bytes: 10,
		largest: note,
		bytes_by_kind: { image: 0, video: 0, audio: 0, text: 10, other: 0 },
		limits: { quota_bytes: 1000, used_bytes: 0, max_file_bytes: 500 },
		free_bytes: 1000,
		blocked: [],
		over_quota: false,
		suggested_exclude: [],
	}
}

function reset_bridge(): void {
	if (bridge.step === 'copying') bridge.step = 'summary'
	close()
	bridge.source = null
	bridge.origin = null
	bridge.preflight = null
	bridge.progress = null
	bridge.resumable = null
	bridge.copied = null
	bridge.error = null
	bridge.pending_intent = null
	bridge.finished_id = null
	bridge.exclude = []
}

beforeEach(() => {
	explorer_language.value = 'en'
	reset_bridge()
	cloud.user = null
	cloud.last_error = null
	cloud.workspaces = []
	cloud.billing = {
		owner_id: 'user-1',
		plan: 'pro',
		plan_status: 'active',
		quota_bytes: 1000,
		max_file_bytes: 500,
		max_hub_listings: null,
		grace_until: null,
		external_subscription_id: null,
	}
	cloud.owner_usage = { used_bytes: 0, live_bytes: 0, trash_bytes: 0 }
	cloud.fetch_plan = async () => {}
	cloud.fetch_workspaces = async () => {}
	preflight_tree.mockReset()
	preflight_tree.mockResolvedValue(sample())
	run_bridge.mockReset()
	link_folder.mockClear()
	set_resume(null)
	set_open(async () => {})
})

afterEach(() => {
	reset_bridge()
	cloud.user = null
	cloud.fetch_plan = fetch_plan
	cloud.fetch_workspaces = fetch_workspaces
	set_resume(null)
	set_open(null)
	vi.useRealTimers()
	explorer_language.value = 'system'
})

function arm(door: 'sync' | 'device' | 'share' | 'publish'): void {
	cloud.user = null
	open(source, door, { fm: {} as FileManager, origin })
	bridge.preflight = sample()
	bridge.step = 'summary'
	cloud.user = { id: 'user-1' } as User
}

describe('bridge session', () => {
	test('signing in returns to the source folder and leaves the panel open on the measurement', async () => {
		const opened: typeof origin[] = []
		set_resume(async (ref) => { opened.push(ref) })
		cloud.user = null
		open(source, 'sync', { fm: {} as FileManager, origin })
		expect(bridge.step).toBe('auth')
		expect(bridge.open).toBe(true)

		cloud.user = { id: 'user-1' } as User
		await vi.waitUntil(() => opened.length === 1 && bridge.step === 'summary' && bridge.open)

		expect(opened).toEqual([origin])
		expect(bridge.open).toBe(true)
		expect(bridge.preflight?.files).toHaveLength(1)
		expect(bridge_panel_view({
			door: bridge.door,
			step: bridge.step,
			source_name: bridge.source?.name ?? '',
			preflight: bridge.preflight,
			exclude: bridge.exclude,
			pro: bridge.pro,
			pro_step: bridge.pro_step,
			resumable: bridge.resumable !== null,
			copied: bridge.copied !== null,
			progress: bridge.progress,
			error: bridge.error,
			plan: cloud.billing?.plan ?? null,
		}).summary).toContain('1 file')
	})

	test('hiding a copy keeps it running, and opening again shows the same progress', async () => {
		let signal: AbortSignal | undefined
		run_bridge.mockImplementation((deps: { jobs: { set: (key: string, job: object) => void } }, run: {
			job_key: string
			signal?: AbortSignal
			on_progress?: (progress: object) => void
		}) => new Promise((resolve) => {
			signal = run.signal
			deps.jobs.set(run.job_key, { workspace_id: 'ws-1', name: 'Notes', phase: 'files', started_at: 1 })
			run.on_progress?.({
				phase: 'files',
				folders_done: 1,
				total_folders: 1,
				loaded_bytes: 0,
				total_bytes: 100,
				files_done: 2,
				total_files: 13,
				current: null,
			})
			run.signal?.addEventListener('abort', () => resolve({ kind: 'aborted', workspace_id: 'ws-1' }))
		}))
		arm('sync')
		const pending = start()
		await vi.waitUntil(() => bridge.step === 'copying' && bridge.progress?.total_files === 13)

		dismiss()
		expect(bridge.open).toBe(false)
		expect(bridge.step).toBe('copying')
		expect(signal?.aborted).toBe(false)
		expect(bridge.progress?.files_done).toBe(2)
		expect(bridge_hidden_tip({
			open: bridge.open,
			step: bridge.step,
			door: bridge.door,
			source_id: bridge.source?.id ?? null,
			progress: bridge.progress,
		}, source.id, 'sync')).toBe('Uploading to cloud: 2 of 13')

		open(source, 'device')
		expect(bridge.open).toBe(true)
		expect(bridge.step).toBe('copying')
		expect(bridge.door).toBe('sync')
		expect(bridge.progress?.files_done).toBe(2)

		cancel()
		await pending
		expect(bridge.step).toBe('summary')
		expect(bridge.resumable?.workspace_id).toBe('ws-1')
		expect(bridge_panel_view({
			door: bridge.door,
			step: bridge.step,
			source_name: bridge.source?.name ?? '',
			preflight: bridge.preflight,
			exclude: bridge.exclude,
			pro: bridge.pro,
			pro_step: bridge.pro_step,
			resumable: bridge.resumable !== null,
			copied: bridge.copied !== null,
			progress: bridge.progress,
			error: bridge.error,
			plan: 'pro',
		}).primary).toBe('Resume upload')
	})

	test('a finished device copy stays up, then hides itself', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		run_bridge.mockResolvedValue({ kind: 'done', workspace_id: 'ws-done', missing: [] })
		arm('device')
		await start()
		expect(bridge.step).toBe('done')
		expect(bridge.open).toBe(true)
		expect(bridge.finished_id).toBe('ws-done')
		vi.advanceTimersByTime(BRIDGE_DONE_MS - 1)
		expect(bridge.open).toBe(true)
		vi.advanceTimersByTime(1)
		expect(bridge.open).toBe(false)
		expect(bridge.step).toBe('done')
	})

	test('share and publish hand off through the pending intent instead of a done panel', async () => {
		run_bridge.mockResolvedValue({ kind: 'done', workspace_id: 'ws-share', missing: [] })
		const opened: string[] = []
		set_open(async (item) => { opened.push(item.id) })
		cloud.workspaces = [{ id: 'ws-share', name: 'Notes' } as never]
		arm('share')
		await start()
		expect(bridge.pending_intent).toEqual({ workspace_id: 'ws-share', door: 'share' })
		expect(bridge.open).toBe(false)
		expect(bridge.step).not.toBe('done')
		expect(opened).toEqual(['ws-share'])

		arm('publish')
		run_bridge.mockResolvedValue({ kind: 'done', workspace_id: 'ws-pub', missing: [] })
		cloud.workspaces = [{ id: 'ws-pub', name: 'Notes' } as never]
		await start()
		expect(bridge.pending_intent).toEqual({ workspace_id: 'ws-pub', door: 'publish' })
		expect(bridge.step).not.toBe('done')
	})

	test('a finished sync links the folder and shows that sync is on', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
		run_bridge.mockResolvedValue({ kind: 'done', workspace_id: 'ws-sync', missing: [] })
		arm('sync')
		await start()
		expect(link_folder).toHaveBeenCalledOnce()
		expect(bridge.step).toBe('done')
		expect(bridge.open).toBe(true)
		expect(bridge_panel_view({
			door: 'sync',
			step: 'done',
			source_name: 'Notes',
			preflight: null,
			exclude: [],
			pro: null,
			pro_step: 'idle',
			resumable: false,
			copied: false,
			progress: null,
			error: null,
			plan: null,
		}).note).toBe('Sync is on')
	})
})

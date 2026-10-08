import { reactive, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import {
	createBrowserFileManager,
	createFileManager,
	create_workspace,
	get_plan_limits,
	record_bridge_event,
	type BridgeEventInput,
	type FileManager,
	type PlanLimits,
} from '@pile-commander/file-manager'
import { require_supabase } from '@/services/cloud/client'
import { create_app_cloud_file_manager } from '@/services/cloud/cloudFileManager'
import { require_browser_storage } from '@/services/desktop/browserDesktopFolders'
import type { CopyTreeProgress } from '@/services/cloud/bridge/copyTree'
import { preflight_tree, type BridgePreflight } from '@/services/cloud/bridge/preflight'
import {
	bridge_job_key,
	resumable_job,
	run_bridge,
	type BridgeDeps,
	type BridgeJob,
	type BridgeResult,
} from '@/services/cloud/bridge/runBridge'
import { create_window_manager } from '@/services/window/WindowManager'
import { extract_pile_to_cache } from '@/services/workspace/pack'
import store from '@/store'
import cloud from '@/store/cloud'
import { link_folder } from '@/store/localSync'

/**
 * Where the copy started. `sync` is the first upload of Auto-sync (store/localSync):
 * the folder stays linked to the new cloud workspace afterwards
 */
export type BridgeDoor = BridgeEventInput['door']

export type BridgeSource = {
	type: 'local' | 'browser'
	/** Root of the local workspace: a folder path (desktop) or a virtual IndexedDB path (web). */
	id: string
	name: string
}

export type BridgeStep = 'auth' | 'measuring' | 'summary' | 'copying' | 'error'

/** What the window of the new cloud workspace does once it is open. */
export type BridgeIntent = { workspace_id: string; door: BridgeDoor }

export type BridgeState = {
	open: boolean
	step: BridgeStep
	source: BridgeSource | null
	door: BridgeDoor
	preflight: BridgePreflight | null
	/** Relative paths of the files left out. */
	exclude: string[]
	/** Pro's storage numbers, shown to Free accounts. */
	pro: PlanLimits | null
	pro_step: 'idle' | 'asking' | 'sent'
	/** An unfinished copy of this source: the primary action resumes it. */
	resumable: BridgeJob | null
	/** A finished copy of this source that still exists. */
	copied: BridgeJob | null
	progress: CopyTreeProgress | null
	error: string | null
	pending_intent: BridgeIntent | null
}

export type OpenBridgeOptions = {
	/** The source's live file manager when the workspace is open (its store's FM). */
	fm?: FileManager
	/** Runs once the dialog is done with the source (a temporary .pile extraction). */
	cleanup?: () => Promise<void>
}

const bridge: BridgeState = reactive({
	open: false,
	step: 'auth',
	source: null,
	door: 'list',
	preflight: null,
	exclude: [],
	pro: null,
	pro_step: 'idle',
	resumable: null,
	copied: null,
	progress: null,
	error: null,
	pending_intent: null,
})

let source_fm: FileManager | null = null
let cleanup: (() => Promise<void>) | null = null
let abort: AbortController | null = null
let opened_recorded = false

const job_storage = useStorage<Record<string, BridgeJob>>('bridge_jobs', {})

const jobs: BridgeDeps['jobs'] = {
	get: key => job_storage.value[key] ?? null,
	set: (key, job) => {
		job_storage.value = { ...job_storage.value, [key]: job }
	},
	remove: (key) => {
		const next = { ...job_storage.value }
		delete next[key]
		job_storage.value = next
	},
}

function bridge_deps(): BridgeDeps {
	const client = require_supabase()
	return {
		create_workspace: name => create_workspace(client, name),
		workspace_fm: workspace_id => create_app_cloud_file_manager(workspace_id),
		// the list is fresh: measure() fetched it before a copy can start
		workspace_exists: async workspace_id => cloud.workspaces.some(ws => ws.id === workspace_id),
		jobs,
	}
}

/** A sync's first upload resumes on its own: a plain copy of the same folder is another job. */
function job_key_of(user_id: string, source: BridgeSource, door: BridgeDoor): string {
	const key = bridge_job_key(user_id, source)
	return door === 'sync' ? `${key}:sync` : key
}

/** The finished copy of this source that still exists, made from any door. */
function finished_copy(user_id: string, source: BridgeSource): BridgeJob | null {
	for (const door of ['sync', 'device'] as const) {
		const job = jobs.get(job_key_of(user_id, source, door))
		if (job?.phase === 'done' && cloud.workspaces.some(ws => ws.id === job.workspace_id)) return job
	}
	return null
}

function source_file_manager(source: BridgeSource): FileManager {
	return source.type === 'browser'
		? createBrowserFileManager(require_browser_storage())
		: createFileManager('local')
}

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

async function run_cleanup(): Promise<void> {
	const run = cleanup
	cleanup = null
	if (!run) return
	try {
		await run()
	} catch (error) {
		console.error(error)
	}
}

/** One funnel step with the size picture of the workspace (bridge_events). */
function record(step: BridgeEventInput['step'], extra: Partial<BridgeEventInput> = {}): void {
	const user = cloud.user
	const source = bridge.source
	const door = bridge.door
	if (!user || !source) return
	const preflight = bridge.preflight
	void record_bridge_event(require_supabase(), user.id, {
		step,
		door,
		source_type: source.type,
		...(preflight
			? {
				total_bytes: preflight.total_bytes,
				file_count: preflight.files.length,
				largest_file_bytes: preflight.largest?.size_bytes ?? null,
				largest_file_mime: preflight.largest?.mime ?? null,
				bytes_by_kind: preflight.bytes_by_kind,
				used_bytes: preflight.limits.used_bytes,
				quota_bytes: preflight.limits.quota_bytes,
				max_file_bytes: preflight.limits.max_file_bytes,
				excluded_files: bridge.exclude.length,
			}
			: {}),
		...extra,
	}).catch((error: unknown) => console.error(error))
}

/**
 * Opens the "copy to cloud" dialog for a local workspace. Signed out, it asks
 * for an account first; signed in, it measures the workspace right away.
 */
export function open_bridge(source: BridgeSource, door: BridgeDoor, options: OpenBridgeOptions = {}): void {
	// one copy at a time: another door just brings the running one back
	if (bridge.step === 'copying') {
		bridge.open = true
		void options.cleanup?.()
		return
	}
	void run_cleanup()
	source_fm = options.fm ?? source_file_manager(source)
	cleanup = options.cleanup ?? null
	opened_recorded = false
	const reset: Partial<BridgeState> = {
		open: true,
		step: cloud.user ? 'measuring' : 'auth',
		source,
		door,
		preflight: null,
		exclude: [],
		pro: null,
		pro_step: 'idle',
		resumable: null,
		copied: null,
		progress: null,
		error: null,
	}
	Object.assign(bridge, reset)
	if (cloud.user) void measure()
}

/** Desktop: a .pile archive becomes a cloud workspace through a temporary local extraction. */
export async function import_pile_to_cloud(pile_path?: string): Promise<void> {
	try {
		const zip_path = pile_path ?? await create_window_manager().pick_pile_file()
		if (!zip_path) return
		const extracted = await extract_pile_to_cache(zip_path)
		open_bridge(
			{ type: 'local', id: extracted.root, name: extracted.name },
			'pile',
			{ cleanup: extracted.dispose },
		)
	} catch (error) {
		store.last_error = message_of(error)
	}
}

/** Reads the plan and walks the workspace: sizes, the wall, a resumable or finished copy. */
export async function measure(): Promise<void> {
	const source = bridge.source
	const fm = source_fm
	const user = cloud.user
	if (!source || !fm || !user) return
	bridge.step = 'measuring'
	bridge.error = null
	try {
		await Promise.all([cloud.fetch_plan(), cloud.fetch_workspaces()])
		const billing = cloud.billing
		const usage = cloud.owner_usage
		if (!billing || !usage) throw new Error(cloud.last_error ?? 'Could not read your cloud plan')
		const [preflight, pro] = await Promise.all([
			preflight_tree(fm, source.id, {
				quota_bytes: billing.quota_bytes,
				used_bytes: usage.used_bytes,
				max_file_bytes: billing.max_file_bytes,
			}),
			billing.plan === 'free'
				? get_plan_limits(require_supabase(), 'pro').catch(() => null)
				: Promise.resolve(null),
		])
		// reopened for another workspace meanwhile
		if (bridge.source !== source) return
		const key = job_key_of(user.id, source, bridge.door)
		bridge.preflight = preflight
		bridge.pro = pro
		bridge.exclude = [...preflight.suggested_exclude]
		bridge.resumable = await resumable_job(bridge_deps(), key)
		bridge.copied = finished_copy(user.id, source)
		bridge.step = 'summary'
		if (!opened_recorded) {
			opened_recorded = true
			record('opened')
		}
		record('preflight')
		if (preflight.over_quota || preflight.blocked.length > 0) record('wall_shown')
	} catch (error) {
		bridge.error = message_of(error)
		bridge.step = 'error'
	}
}

function plan_limit_message(result: Extract<BridgeResult, { kind: 'plan_limit' }>): string {
	return result.info.kind === 'file_size'
		? `${result.file} is over the per-file limit. Leave it out and resume.`
		: 'The cloud storage filled up during the copy. Leave out more files and resume.'
}

/** Copies (or resumes copying) the measured workspace without the excluded files. */
export async function start_copy(): Promise<void> {
	const source = bridge.source
	const preflight = bridge.preflight
	const fm = source_fm
	const user = cloud.user
	if (!source || !preflight || !fm || !user || bridge.step === 'copying') return
	const key = job_key_of(user.id, source, bridge.door)
	const controller = new AbortController()
	abort = controller
	record(bridge.resumable ? 'resumed' : 'started', { workspace_id: bridge.resumable?.workspace_id ?? null })
	bridge.step = 'copying'
	bridge.progress = null
	bridge.error = null
	try {
		const result = await run_bridge(bridge_deps(), {
			job_key: key,
			name: source.name,
			source_fm: fm,
			source_root: source.id,
			preflight,
			exclude: new Set(bridge.exclude),
			on_progress: (progress) => {
				bridge.progress = progress
			},
			signal: controller.signal,
		})
		await cloud.fetch_workspaces()
		void cloud.fetch_plan()
		if (result.kind === 'done') {
			record('completed', { workspace_id: result.workspace_id })
			await finish(result.workspace_id, key)
			return
		}
		if (result.kind === 'aborted') {
			record('cancelled', { workspace_id: result.workspace_id })
			bridge.resumable = jobs.get(key)
			bridge.step = 'summary'
			return
		}
		// the preflight numbers went stale (another device uploaded meanwhile)
		record('wall_shown', { workspace_id: result.workspace_id })
		await measure()
		bridge.error = plan_limit_message(result)
	} catch (error) {
		record('failed', { workspace_id: jobs.get(key)?.workspace_id ?? null })
		await cloud.fetch_workspaces()
		bridge.resumable = await resumable_job(bridge_deps(), key)
		bridge.error = message_of(error)
		bridge.step = 'summary'
	} finally {
		if (abort === controller) abort = null
	}
}

async function finish(workspace_id: string, job_key: string): Promise<void> {
	// an extracted .pile is removed after the copy: its job has nothing to resume
	if (bridge.door === 'pile') jobs.remove(job_key)
	const source = bridge.source
	if (bridge.door === 'sync' && source) {
		// the folder stays open here; its first sync pass adopts the copy just made
		await link_folder({
			root: source.id,
			name: source.name,
			workspace_id,
			exclude: [...bridge.exclude],
			adopt_before: Date.now(),
		})
		bridge.open = false
		bridge.step = 'summary'
		await run_cleanup()
		return
	}
	const item = cloud.workspaces.find(ws => ws.id === workspace_id)
	bridge.pending_intent = { workspace_id, door: bridge.door }
	bridge.step = 'summary'
	bridge.open = false
	await run_cleanup()
	if (item) await store.load_workspace(item)
}

/** Stops the running copy after the uploads in flight; it stays resumable. */
export function cancel_copy(): void {
	abort?.abort()
}

export function close_bridge(): void {
	if (bridge.step === 'copying') return
	if (bridge.pro_step === 'asking') submit_pro(null)
	bridge.open = false
	void run_cleanup()
}

/** Removes the cloud workspace of an unfinished copy. */
export async function delete_partial_copy(): Promise<void> {
	const job = bridge.resumable
	const source = bridge.source
	const user = cloud.user
	if (!job || !source || !user) return
	await cloud.remove(job.workspace_id)
	if (cloud.last_error) {
		bridge.error = cloud.last_error
		return
	}
	jobs.remove(job_key_of(user.id, source, bridge.door))
	bridge.resumable = null
}

/**
 * Auto-sync into the earlier cloud copy of this folder instead of a new one.
 * Files the copy holds unchanged are adopted; files edited here since then
 * update it, unless they were edited in the cloud too
 */
export async function sync_with_copied(): Promise<void> {
	const job = bridge.copied
	const source = bridge.source
	if (!job || !source || bridge.door !== 'sync') return
	try {
		await link_folder({
			root: source.id,
			name: source.name,
			workspace_id: job.workspace_id,
			adopt_before: job.finished_at ?? job.started_at,
		})
		close_bridge()
	} catch (error) {
		bridge.error = message_of(error)
	}
}

/** Opens the finished earlier copy of this workspace instead of copying again. */
export function open_copied(): void {
	const job = bridge.copied
	if (!job) return
	const item = cloud.workspaces.find(ws => ws.id === job.workspace_id)
	close_bridge()
	if (item) void store.load_workspace(item)
}

export function toggle_exclude(relative: string): void {
	const index = bridge.exclude.indexOf(relative)
	if (index >= 0) bridge.exclude.splice(index, 1)
	else bridge.exclude.push(relative)
}

/** Paid plans are not on sale in the beta: the click asks what the person collects. */
export function click_pro(): void {
	if (bridge.pro_step === 'idle') bridge.pro_step = 'asking'
}

/** Records the Pro click once, with the answer when there is one. */
export function submit_pro(answer: string | null): void {
	if (bridge.pro_step !== 'asking') return
	bridge.pro_step = 'sent'
	record('pro_clicked', { answer })
}

/** The intent for this cloud workspace, consumed by the first window that shows it. */
export function take_bridge_intent(workspace_id: string): BridgeIntent | null {
	const intent = bridge.pending_intent
	if (!intent || intent.workspace_id !== workspace_id) return null
	bridge.pending_intent = null
	return intent
}

// signing in from the dialog continues with the measurement; signing out
// sends it back to the account step
watch(
	() => cloud.user?.id ?? null,
	(user_id) => {
		if (!bridge.open || bridge.step === 'copying') return
		if (user_id && bridge.step === 'auth') void measure()
		if (!user_id) bridge.step = 'auth'
	},
)

export default bridge

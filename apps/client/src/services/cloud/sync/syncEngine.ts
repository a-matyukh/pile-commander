import { is_missing_path_error } from '@/store/helpers/fsErrors'
import { run_sync_pass, type SyncPassDeps, type SyncProgress, type SyncReport } from './syncPass'
import type { SyncState } from './types'

export type SyncStatus = {
	/**
	 * idle: synced, waiting for a change · syncing: a pass is running ·
	 * paused: waits for the person (mass delete, the plan) or for the folder
	 * to come back · error: retried soon
	 */
	phase: 'idle' | 'syncing' | 'paused' | 'error'
	/**
	 * mass_delete_cloud: most of the cloud copy would go to the cloud trash
	 * (the folder was emptied here); mass_delete_local: most of the folder
	 * would go to the system trash (the cloud workspace was emptied);
	 * folder_missing: the linked folder is not on this computer (moved,
	 * deleted, or the disk is unplugged). The link stays.
	 */
	reason?: 'mass_delete_cloud' | 'mass_delete_local' | 'plan_limit' | 'unlinked' | 'folder_missing'
	message?: string
	last_synced_at?: number
	/** Files a paused pass would trash (on the side `reason` names). */
	pending_deletes?: number
	/** While a pass moves bytes or entries. */
	progress?: SyncProgress
	/** Recent conflicted copies, newest last. */
	conflicts: string[]
	/** Folders kept here because of hidden files, newest last. */
	kept_for_hidden: string[]
	/**
	 * The folders a pass just recreated for that reason. `pass` increases
	 * once per such pass, so a toast can fire once and not on later status updates.
	 */
	kept_hidden_notice?: { pass: number; folders: string[] }
	skipped: SyncReport['skipped']
	errors: SyncReport['errors']
}

export type SyncEngineDeps = {
	/** The link's state, or null when the folder is not linked here (a copy, another account). */
	load_state(): Promise<SyncState | null>
	save_state(state: SyncState): Promise<void>
	pass_deps(state: SyncState): SyncPassDeps
	max_file_bytes(): number
	/**
	 * False when the linked folder is not a directory on this computer.
	 * Omitted means it is here. A missing root pauses; it is not scanned.
	 */
	root_present?(): Promise<boolean>
	/** Calls back on any change in the folder; resolves to the unwatch. */
	watch(on_change: () => void): Promise<() => void>
	/** Calls back on any change of the cloud workspace made elsewhere; resolves to the unwatch. */
	watch_cloud?(on_change: () => void): Promise<() => void>
	on_status(status: SyncStatus): void
}

export type SyncTiming = {
	/** Quiet time after the last change before a pass. */
	debounce_ms: number
	/** A pass now and then, for changes the watcher missed. */
	interval_ms: number
	/** Waits after failed passes in a row; the last one repeats. */
	retry_ms: readonly number[]
}

export const DEFAULT_SYNC_TIMING: SyncTiming = {
	debounce_ms: 2_000,
	interval_ms: 5 * 60_000,
	retry_ms: [30_000, 60_000, 120_000, 300_000],
}

/** Conflicted copies kept in the status. */
const CONFLICTS_SHOWN = 50

export type SyncNowOptions = {
	allow_cloud_deletes?: boolean
	allow_local_deletes?: boolean
}

export type SyncEngine = {
	start(): Promise<void>
	stop(): void
	/** A pass right away that also reads the cloud; the `allow_*` flags confirm a paused one. */
	sync_now(options?: SyncNowOptions): Promise<void>
}

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** First join failed because the socket was not up. A later join uses a fresh topic. */
function is_retryable_subscribe(error: unknown): boolean {
	return /watch subscribe failed: (CHANNEL_ERROR|TIMED_OUT)/.test(message_of(error))
}

const FOLDER_MISSING = 'This folder is not on this computer.'

/**
 * Keeps one linked folder in sync while the app runs: a pass at start, after
 * changes here or in the cloud settle, every few minutes, and again after a
 * failure with backoff. A missing folder pauses until it is back: no pass,
 * no watch, no log. A cloud subscribe that fails to join is retried with the
 * same backoff and is not logged. Passes never overlap; a change during a
 * pass queues one more. A pass reads the cloud only when it may have changed:
 * at start, after a cloud event, on the interval and on Sync now.
 */
export function create_sync_engine(deps: SyncEngineDeps, timing: SyncTiming = DEFAULT_SYNC_TIMING): SyncEngine {
	let state: SyncState | null = null
	let status: SyncStatus = { phase: 'idle', conflicts: [], kept_for_hidden: [], skipped: [], errors: [] }
	let hidden_notice_pass = 0
	let running: Promise<void> | null = null
	let again = false
	// the next pass reads the cloud even if nothing changed here: true at
	// start, after a cloud event, on the interval and on Sync now
	let cloud_dirty = true
	let stopped = true
	let failures = 0
	let cloud_watch_failures = 0
	let timer: ReturnType<typeof setTimeout> | null = null
	let interval: ReturnType<typeof setInterval> | null = null
	let unwatch: (() => void) | null = null
	let unwatch_cloud: (() => void) | null = null

	const publish = (patch: Partial<SyncStatus>) => {
		status = { ...status, ...patch }
		deps.on_status(status)
	}

	const schedule = (delay_ms: number) => {
		if (stopped) return
		if (timer) clearTimeout(timer)
		timer = setTimeout(() => {
			timer = null
			void run()
		}, delay_ms)
	}

	function release_watches() {
		unwatch?.()
		unwatch_cloud?.()
		unwatch = null
		unwatch_cloud = null
	}

	/** The link stays. The interval looks again; nothing is scanned until the folder is back. */
	function pause_for_missing_root() {
		if (stopped) return
		release_watches()
		failures = 0
		cloud_watch_failures = 0
		if (timer) clearTimeout(timer)
		timer = null
		if (status.phase === 'paused' && status.reason === 'folder_missing') return
		publish({
			phase: 'paused',
			reason: 'folder_missing',
			message: FOLDER_MISSING,
			progress: undefined,
			pending_deletes: undefined,
			errors: [],
		})
	}

	async function root_is_here(): Promise<boolean> {
		if (!deps.root_present) return true
		const here = await deps.root_present()
		if (stopped) return false
		if (here) return true
		pause_for_missing_root()
		return false
	}

	/** False when the folder is gone, so the caller skips the cloud watch and the pass. */
	async function arm_local_watch(): Promise<boolean> {
		if (stopped) return false
		if (unwatch) return true
		try {
			const next = await deps.watch(() => schedule(timing.debounce_ms))
			if (stopped) {
				next()
				return false
			}
			unwatch = next
			return true
		} catch (error) {
			if (stopped) return false
			if (is_missing_path_error(error)) {
				pause_for_missing_root()
				return false
			}
			// without a watcher the interval still catches up
			console.error('[sync] watch failed', error)
			return true
		}
	}

	async function arm_cloud_watch(): Promise<void> {
		if (unwatch_cloud || stopped || !deps.watch_cloud) return
		try {
			const next = await deps.watch_cloud(() => {
				cloud_dirty = true
				schedule(timing.debounce_ms)
			})
			if (stopped) {
				next()
				return
			}
			unwatch_cloud = next
			cloud_watch_failures = 0
		} catch (error) {
			if (stopped) return
			if (!is_retryable_subscribe(error)) {
				console.error('[sync] cloud watch failed', error)
				return
			}
			const delay = timing.retry_ms[Math.min(cloud_watch_failures, timing.retry_ms.length - 1)] ?? timing.interval_ms
			cloud_watch_failures += 1
			schedule(delay)
		}
	}

	async function pass(confirm: SyncNowOptions): Promise<void> {
		state ??= await deps.load_state()
		if (!state) {
			publish({ phase: 'paused', reason: 'unlinked', message: 'This folder is not linked to a cloud workspace on this device.' })
			return
		}
		publish({ phase: 'syncing' })
		const check_cloud = cloud_dirty
		cloud_dirty = false
		let result: Awaited<ReturnType<typeof run_sync_pass>>
		try {
			const pass_deps: SyncPassDeps = {
				...deps.pass_deps(state),
				on_progress: progress => publish({ progress }),
			}
			result = await run_sync_pass(pass_deps, state, {
				max_file_bytes: deps.max_file_bytes(),
				check_cloud,
				...confirm,
			})
		} catch (error) {
			// the cloud still has to be read once the failure clears
			cloud_dirty ||= check_cloud
			publish({ progress: undefined })
			throw error
		}
		publish({ progress: undefined })
		failures = 0
		const present = new Set(result.local_folders)
		const kept_still_here = (fresh: readonly string[]) =>
			[...new Set([...status.kept_for_hidden.filter(folder => present.has(folder)), ...fresh])].slice(-CONFLICTS_SHOWN)
		if (result.kind === 'unchanged') {
			publish({
				phase: 'idle',
				reason: undefined,
				message: undefined,
				pending_deletes: undefined,
				skipped: result.skipped,
				errors: [],
				kept_for_hidden: kept_still_here([]),
			})
			return
		}
		if (result.kind === 'mass_delete') {
			// read the cloud again on the next pass: the person may restore the files instead
			cloud_dirty = true
			publish({
				phase: 'paused',
				reason: result.side === 'cloud' ? 'mass_delete_cloud' : 'mass_delete_local',
				pending_deletes: result.deletes,
				message: result.side === 'cloud'
					? `${result.deletes} of ${result.base_files} files are gone from this folder.`
					: `${result.deletes} of ${result.base_files} files are gone from the cloud workspace.`,
				kept_for_hidden: kept_still_here([]),
			})
			return
		}
		state = result.state
		await deps.save_state(state)
		const conflicts = [...status.conflicts, ...result.report.conflicts].slice(-CONFLICTS_SHOWN)
		const fresh_hidden = result.report.kept_for_hidden
		const kept_for_hidden = kept_still_here(fresh_hidden)
		const kept_hidden_notice = fresh_hidden.length === 0
			? status.kept_hidden_notice
			: { pass: ++hidden_notice_pass, folders: [...fresh_hidden] }
		const common = {
			last_synced_at: state.last_synced_at,
			conflicts,
			kept_for_hidden,
			kept_hidden_notice,
			skipped: result.report.skipped,
			errors: result.report.errors,
			pending_deletes: undefined,
		}
		if (result.kind === 'plan_limit') {
			publish({
				...common,
				phase: 'paused',
				reason: 'plan_limit',
				message: result.info.kind === 'file_size'
					? `${result.file} is over your plan's per-file limit.`
					: 'Your cloud storage is full.',
			})
			return
		}
		publish({ ...common, phase: 'idle', reason: undefined, message: undefined })
	}

	async function run(confirm: SyncNowOptions = {}): Promise<void> {
		if (stopped) return
		if (running) {
			again = true
			return running
		}
		running = (async () => {
			try {
				if (!(await root_is_here())) return
				if (stopped) return
				if (!(await arm_local_watch())) return
				if (stopped) return
				await arm_cloud_watch()
				if (stopped) return
				await pass(confirm)
			} catch (error) {
				if (stopped) return
				if (is_missing_path_error(error)) {
					pause_for_missing_root()
					return
				}
				failures += 1
				publish({ phase: 'error', reason: undefined, message: message_of(error) })
				schedule(timing.retry_ms[Math.min(failures, timing.retry_ms.length) - 1] ?? timing.interval_ms)
			} finally {
				running = null
			}
			if (again && !stopped) {
				again = false
				schedule(timing.debounce_ms)
			}
		})()
		return running
	}

	return {
		async start() {
			if (!stopped) return
			stopped = false
			deps.on_status(status)
			interval = setInterval(() => {
				cloud_dirty = true
				void run()
			}, timing.interval_ms)
			await run()
			if (stopped) release_watches()
		},
		stop() {
			stopped = true
			if (timer) clearTimeout(timer)
			if (interval) clearInterval(interval)
			timer = null
			interval = null
			release_watches()
		},
		async sync_now(options = {}) {
			if (timer) clearTimeout(timer)
			timer = null
			if (running) await running
			cloud_dirty = true
			await run(options)
		},
	}
}

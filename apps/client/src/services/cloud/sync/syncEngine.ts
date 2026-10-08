import { run_sync_pass, type SyncPassDeps, type SyncReport } from './syncPass'
import type { SyncState } from './types'

export type SyncStatus = {
	/**
	 * idle: synced, waiting for a change · syncing: a pass is running ·
	 * paused: waits for the person (mass delete, the plan) · error: retried soon
	 */
	phase: 'idle' | 'syncing' | 'paused' | 'error'
	reason?: 'mass_delete' | 'plan_limit' | 'unlinked'
	message?: string
	last_synced_at?: number
	/** Files a paused pass would trash in the cloud. */
	pending_deletes?: number
	/** Recent conflicted copies, newest last. */
	conflicts: string[]
	skipped: SyncReport['skipped']
	errors: SyncReport['errors']
}

export type SyncEngineDeps = {
	/** The link's state, or null when the folder is not linked here (a copy, another account). */
	load_state(): Promise<SyncState | null>
	save_state(state: SyncState): Promise<void>
	pass_deps(state: SyncState): SyncPassDeps
	max_file_bytes(): number
	/** Calls back on any change in the folder; resolves to the unwatch. */
	watch(on_change: () => void): Promise<() => void>
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

export type SyncEngine = {
	start(): Promise<void>
	stop(): void
	/** A pass right away; `allow_mass_delete` confirms a paused one. */
	sync_now(options?: { allow_mass_delete?: boolean }): Promise<void>
}

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/**
 * Keeps one linked folder in sync while the app runs: a pass at start, after
 * changes settle, every few minutes, and again after a failure with backoff.
 * Passes never overlap; a change during a pass queues one more.
 */
export function create_sync_engine(deps: SyncEngineDeps, timing: SyncTiming = DEFAULT_SYNC_TIMING): SyncEngine {
	let state: SyncState | null = null
	let status: SyncStatus = { phase: 'idle', conflicts: [], skipped: [], errors: [] }
	let running: Promise<void> | null = null
	let again = false
	let stopped = true
	let failures = 0
	let timer: ReturnType<typeof setTimeout> | null = null
	let interval: ReturnType<typeof setInterval> | null = null
	let unwatch: (() => void) | null = null

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

	async function pass(allow_mass_delete: boolean): Promise<void> {
		state ??= await deps.load_state()
		if (!state) {
			publish({ phase: 'paused', reason: 'unlinked', message: 'This folder is not linked to a cloud workspace on this device.' })
			return
		}
		publish({ phase: 'syncing' })
		const result = await run_sync_pass(deps.pass_deps(state), state, {
			max_file_bytes: deps.max_file_bytes(),
			allow_mass_delete,
		})
		failures = 0
		if (result.kind === 'unchanged') {
			publish({ phase: 'idle', reason: undefined, message: undefined, pending_deletes: undefined, skipped: result.skipped, errors: [] })
			return
		}
		if (result.kind === 'mass_delete') {
			publish({
				phase: 'paused',
				reason: 'mass_delete',
				pending_deletes: result.deletes,
				message: `${result.deletes} of ${result.base_files} files are gone from this folder.`,
			})
			return
		}
		state = result.state
		await deps.save_state(state)
		const conflicts = [...status.conflicts, ...result.report.conflicts].slice(-CONFLICTS_SHOWN)
		const common = {
			last_synced_at: state.last_synced_at,
			conflicts,
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

	async function run(allow_mass_delete = false): Promise<void> {
		if (stopped) return
		if (running) {
			again = true
			return running
		}
		running = (async () => {
			try {
				await pass(allow_mass_delete)
			} catch (error) {
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
			interval = setInterval(() => void run(), timing.interval_ms)
			try {
				unwatch = await deps.watch(() => schedule(timing.debounce_ms))
			} catch (error) {
				// without a watcher the interval still catches up
				console.error('[sync] watch failed', error)
			}
			if (stopped) {
				unwatch?.()
				unwatch = null
				return
			}
			await run()
		},
		stop() {
			stopped = true
			if (timer) clearTimeout(timer)
			if (interval) clearInterval(interval)
			timer = null
			interval = null
			unwatch?.()
			unwatch = null
		},
		async sync_now(options = {}) {
			if (timer) clearTimeout(timer)
			timer = null
			if (running) await running
			await run(options.allow_mass_delete ?? false)
		},
	}
}

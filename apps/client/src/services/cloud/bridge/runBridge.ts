import type { FileManager, PlanLimitInfo } from '@pile-commander/file-manager'
import { applyPileAttrs, collectPileAttrs } from '@pile-commander/file-manager'
import { copy_tree, type CopyTreeProgress } from './copyTree'
import { copied_paths, filter_manifest } from './manifest'
import type { BridgePreflight } from './preflight'

export type BridgeJobPhase = 'files' | 'attrs' | 'done'

/**
 * Where the cloud copy of one local workspace stands. Kept per account and
 * source, so a rerun after a crash resumes into the same cloud workspace
 * instead of creating a second one.
 */
export type BridgeJob = {
	workspace_id: string
	name: string
	phase: BridgeJobPhase
	started_at: number
	finished_at?: number
}

export type BridgeJobs = {
	get(key: string): BridgeJob | null
	set(key: string, job: BridgeJob): void
	remove(key: string): void
}

export type BridgeDeps = {
	create_workspace(name: string): Promise<string>
	workspace_fm(workspace_id: string): FileManager
	/** An unfinished job whose workspace is gone (removed meanwhile) starts over. */
	workspace_exists(workspace_id: string): Promise<boolean>
	jobs: BridgeJobs
}

export type BridgeRun = {
	job_key: string
	/** Name of the cloud workspace a new copy creates. */
	name: string
	source_fm: FileManager
	source_root: string
	preflight: BridgePreflight
	/** Relative paths of files to leave out. */
	exclude: ReadonlySet<string>
	on_progress?: (progress: CopyTreeProgress) => void
	signal?: AbortSignal
}

export type BridgeResult =
	| { kind: 'done'; workspace_id: string; missing: string[] }
	| { kind: 'plan_limit'; workspace_id: string; info: PlanLimitInfo; file: string }
	| { kind: 'aborted'; workspace_id: string }

/** Jobs are per account: another account on this device starts its own copy. */
export function bridge_job_key(user_id: string, source: { type: string; id: string }): string {
	return `${user_id}:${source.type}:${source.id}`
}

/** The unfinished copy of this source, when its workspace still exists. */
export async function resumable_job(deps: BridgeDeps, job_key: string): Promise<BridgeJob | null> {
	const job = deps.jobs.get(job_key)
	if (!job || job.phase === 'done') return null
	if (await deps.workspace_exists(job.workspace_id)) return job
	deps.jobs.remove(job_key)
	return null
}

/**
 * Copies a local workspace into the cloud: a new cloud workspace, its files,
 * then the layout — xattrs, ink under fresh ids, edges. An unfinished job of
 * the same source resumes into its cloud workspace; a finished one keeps that
 * copy and a new run makes another. The source is only read.
 */
export async function run_bridge(deps: BridgeDeps, run: BridgeRun): Promise<BridgeResult> {
	let job = await resumable_job(deps, run.job_key)
	if (!job) {
		const created = await deps.create_workspace(run.name)
		job = { workspace_id: created, name: run.name, phase: 'files', started_at: Date.now() }
		deps.jobs.set(run.job_key, job)
	}
	const { workspace_id } = job
	const dst_fm = deps.workspace_fm(workspace_id)

	if (job.phase === 'files') {
		const copied = await copy_tree(run.source_fm, dst_fm, '/', run.preflight, {
			exclude: run.exclude,
			on_progress: run.on_progress,
			signal: run.signal,
		})
		if (copied.kind === 'plan_limit') {
			return { kind: 'plan_limit', workspace_id, info: copied.info, file: copied.file }
		}
		if (copied.kind === 'aborted') return { kind: 'aborted', workspace_id }
		job = { ...job, phase: 'attrs' }
		deps.jobs.set(run.job_key, job)
	}

	const manifest = filter_manifest(
		await collectPileAttrs(run.source_fm, run.source_root),
		copied_paths(run.preflight, run.exclude),
	)
	const applied = await applyPileAttrs(dst_fm, '/', manifest, { fresh_stroke_ids: true })
	deps.jobs.set(run.job_key, { ...job, phase: 'done', finished_at: Date.now() })
	return { kind: 'done', workspace_id, missing: applied.missing }
}

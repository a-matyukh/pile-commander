import type { ConnectionRow, FileManager, FolderConnection, FolderStroke, PlanLimitInfo, StrokeRow } from '@pile-commander/file-manager'
import { MAX_TEXT_CONTENT_BYTES, PILE_DIR_NAME, PlanLimitError, decode_text_content, is_text_mime } from '@pile-commander/file-manager'
import { read_entry_blob, upload_mime } from '@/services/workspace/entryBytes'
import { hash_value } from './hash'
import {
	connection_hash,
	connection_key,
	lift_v1_connections,
	lift_v1_strokes,
	lift_v1_xattrs,
	merge_connections,
	merge_strokes,
	merge_xattrs,
	stroke_hash,
} from './layoutSync'
import { read_local_layout, scan_local, type LocalFolderLayout, type LocalLayout, type LocalStat } from './localScan'
import { base_name, cloud_relative, is_within, join_cloud, join_local, parent_relative, relative_of } from './paths'
import { partition_local, reconcile, type ReconcileOptions } from './reconcile'
import { SYNC_STATE_VERSION, type BaseEntry, type BaseFolderLayout, type CloudEntry, type ConnectionBase, type LocalEntry, type SkipReason, type StrokeBase, type SyncAction, type SyncState } from './types'

/**
 * Writes to the synced folder that the local file manager does not cover.
 * The real one lives in store/localSync.ts (plugin-fs, the `trash_path`
 * command); tests use a fake
 */
export type LocalWriter = {
	/**
	 * Writes `data` as `name` in `folder` without a half-written file ever
	 * showing: a temporary file under `<folder>/.pile` renamed over the
	 * target. Xattrs of a file it replaces are not kept
	 */
	write_file(folder: string, name: string, data: Blob): Promise<void>
	/** Moves a file or folder to the system trash. */
	trash(path: string): Promise<void>
}

export type SyncPassDeps = {
	local_fm: FileManager
	/** The synced folder's absolute path. */
	root: string
	stat: LocalStat
	writer: LocalWriter
	/** File manager of the linked cloud workspace. */
	cloud_fm: FileManager
	/** Every live entry of the linked workspace. */
	list_cloud(): Promise<CloudEntry[]>
	/** Every stroke and edge of the linked workspace (ends and folders as entry uuids). */
	list_cloud_layout(): Promise<{ strokes: StrokeRow[]; connections: ConnectionRow[] }>
	/** Hard-deletes a trashed cloud entry by id. */
	purge(cloud_id: string): Promise<void>
	read_blob?: (fm: FileManager, id: string, name: string, mime: string) => Promise<Blob>
	/**
	 * Replaces a cloud file's bytes in place. Absent, or `'unsupported'`,
	 * means this backend cannot: the pass falls back to trash, purge, upload.
	 */
	replace_blob?: (cloud_path: string, blob: Blob, mime: string) => Promise<'replaced' | 'unsupported'>
	/**
	 * Persists the state in the middle of a pass, so an interrupted pass does
	 * not mistake its own writes for changes made on both sides
	 */
	save_progress?: (state: SyncState) => Promise<void>
	/** Told before and after each action that moves bytes or entries. */
	on_progress?: (progress: SyncProgress) => void
	now?: () => Date
}

/** How far a pass is: actions done of all that move bytes or entries, and the one under way. */
export type SyncProgress = {
	done: number
	total: number
	current: string | null
}

export type SyncPassOptions = {
	max_file_bytes: number
	/** Read the cloud even when nothing changed here (start, a cloud event, the interval, Sync now). */
	check_cloud?: boolean
	/** The person confirmed that a large share of the cloud copy goes to the cloud trash. */
	allow_cloud_deletes?: boolean
	/** The person confirmed that a large share of the folder goes to the system trash. */
	allow_local_deletes?: boolean
}

export type SyncReport = {
	uploaded: number
	updated: number
	downloaded: number
	moved: number
	/** Files moved to the cloud trash. */
	deleted: number
	/** Files moved to the system trash here. */
	trashed: number
	/** Relative paths whose local version went up as a conflicted copy. */
	conflicts: string[]
	skipped: { relative: string; reason: SkipReason }[]
	/** Actions that failed this pass; they are retried on the next one. */
	errors: { relative: string; message: string }[]
}

export type SyncPassResult =
	/** Nothing changed here since the last pass, and the cloud was not asked. */
	| { kind: 'unchanged'; skipped: SyncReport['skipped'] }
	| { kind: 'done'; state: SyncState; report: SyncReport }
	/**
	 * The pass would trash much of one side: a folder emptied or unmounted
	 * here (`cloud`), or a cloud workspace emptied elsewhere (`local`)
	 */
	| { kind: 'mass_delete'; side: 'cloud' | 'local'; deletes: number; base_files: number }
	/** The plan refused a file; what synced before it is kept in `state`. */
	| { kind: 'plan_limit'; state: SyncState; report: SyncReport; info: PlanLimitInfo; file: string }

/** A pass that would trash at least this many files and over half of one side asks first. */
export const MASS_DELETE_MIN = 20

/** Failures in a row that end a pass: the network is gone, not one file. */
const FAILURES_IN_A_ROW = 3

/** Content writes save the state at most this often; moves and deletes save right away. */
const PROGRESS_SAVE_MS = 2_000

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

function cloud_parent(path: string): string {
	const index = path.lastIndexOf('/')
	return index <= 0 ? '/' : path.slice(0, index)
}

function pad(value: number): string {
	return String(value).padStart(2, '0')
}

/** "note (conflicted copy 2026-10-08 1430).md", unique among `taken`. */
export function conflicted_name(name: string, date: Date, taken: ReadonlySet<string>): string {
	const dot = name.lastIndexOf('.')
	const stem = dot > 0 ? name.slice(0, dot) : name
	const ext = dot > 0 ? name.slice(dot) : ''
	const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}${pad(date.getMinutes())}`
	let candidate = `${stem} (conflicted copy ${stamp})${ext}`
	for (let n = 2; taken.has(candidate); n++) candidate = `${stem} (conflicted copy ${stamp} ${n})${ext}`
	return candidate
}

/** Anything here differs from the base: a new, edited or gone entry, or changed layout. */
function has_local_changes(
	state: SyncState,
	local: ReadonlyMap<string, LocalEntry>,
	skipped: ReadonlySet<string>,
	layout: LocalLayout,
): boolean {
	for (const entry of local.values()) {
		const known = state.entries[entry.relative]
		if (!known || known.kind !== entry.kind) return true
		if (entry.kind === 'file' && (known.size !== entry.size || known.mtime_ms !== entry.mtime_ms)) return true
	}
	for (const relative of Object.keys(state.entries)) {
		if (!local.has(relative) && !skipped.has(relative)) return true
	}
	if (xattrs_differ(state.root_xattrs, state.root_xattrs_hash, layout.xattrs.get('') ?? {})) return true
	for (const [relative, known] of Object.entries(state.entries)) {
		if (!local.has(relative)) continue
		if (xattrs_differ(known.xattrs, known.xattrs_hash, layout.xattrs.get(relative) ?? {})) return true
	}
	for (const [relative, folder] of layout.folders) {
		if (folder_layout_differs(state.layout[relative] ?? {}, folder)) return true
	}
	return false
}

function xattrs_differ(
	known: Readonly<Record<string, string>> | undefined,
	legacy_hash: string | undefined,
	local: Readonly<Record<string, string>>,
): boolean {
	if (known) return hash_value(known) !== hash_value(local)
	if (legacy_hash !== undefined) return legacy_hash !== hash_value(local)
	return Object.keys(local).length > 0
}

/** Ink or edges here differ from what both sides held. */
function folder_layout_differs(known: BaseFolderLayout, folder: LocalFolderLayout): boolean {
	if (known.strokes) {
		const expected = new Map(Object.values(known.strokes).map(stroke => [stroke.local_id, stroke.hash]))
		if (expected.size !== folder.strokes.length) return true
		if (folder.strokes.some(stroke => expected.get(stroke.id) !== stroke_hash(stroke))) return true
	} else if (known.strokes_hash !== undefined ? known.strokes_hash !== folder.legacy.strokes_hash : folder.strokes.length > 0) {
		return true
	}
	if (known.connections) {
		const keys = Object.keys(known.connections)
		if (keys.length !== folder.connections.length) return true
		if (folder.connections.some(edge => known.connections![connection_key(edge)]?.hash !== connection_hash(edge))) return true
	} else if (known.connections_hash !== undefined ? known.connections_hash !== folder.legacy.connections_hash : folder.connections.length > 0) {
		return true
	}
	return false
}

function folders_of(local: ReadonlyMap<string, LocalEntry>): string[] {
	return ['', ...[...local.values()].filter(entry => entry.kind === 'folder').map(entry => entry.relative)]
}

/**
 * One two-way pass over a linked folder. Reads the folder first; when nothing
 * changed here and the cloud need not be asked, it stops right there.
 * Otherwise it lists the cloud workspace, reconciles (reconcile.ts), carries
 * the actions out on both sides, reads the cloud back for the new base, reads
 * the folder's layout again (moves and downloads changed it) and pushes it.
 * Returns the next state; the caller persists it.
 */
export async function run_sync_pass(
	deps: SyncPassDeps,
	state: SyncState,
	options: SyncPassOptions,
): Promise<SyncPassResult> {
	const reconcile_options: ReconcileOptions = {
		exclude: new Set(state.exclude),
		max_file_bytes: options.max_file_bytes,
		adopt_before: state.adopt_before,
	}
	const scanned = await scan_local(deps.local_fm, deps.root, deps.stat)
	const { local, skipped, skips } = partition_local(scanned, reconcile_options)
	const skipped_report = skips.flatMap(action => action.kind === 'skip' ? [{ relative: action.relative, reason: action.reason }] : [])
	const early_layout = await read_local_layout(deps.local_fm, deps.root, folders_of(local))
	if (!options.check_cloud && !has_local_changes(state, local, skipped, early_layout)) {
		return { kind: 'unchanged', skipped: skipped_report }
	}

	const cloud_before = await deps.list_cloud()
	const plan = reconcile(state.entries, scanned, cloud_before, reconcile_options)
	const too_many = (deletes: number) => deletes >= MASS_DELETE_MIN && deletes * 2 > plan.base_files
	if (!options.allow_cloud_deletes && too_many(plan.deletes)) {
		return { kind: 'mass_delete', side: 'cloud', deletes: plan.deletes, base_files: plan.base_files }
	}
	if (!options.allow_local_deletes && too_many(plan.local_deletes)) {
		return { kind: 'mass_delete', side: 'local', deletes: plan.local_deletes, base_files: plan.base_files }
	}

	const run = new PassRun(deps, state, local, cloud_before)
	const stop = await run.apply(plan.actions)
	const cloud_after = await deps.list_cloud()
	run.refresh(cloud_after)
	if (!stop) {
		// read after the actions: moves and downloads changed the folder's layout
		const folders = folders_of(run.local)
		const [layout, cloud_layout] = await Promise.all([
			read_local_layout(deps.local_fm, deps.root, folders),
			deps.list_cloud_layout(),
		])
		await run.merge_layout(layout, folders, cloud_after, cloud_layout)
	}
	const next: SyncState = {
		...run.state,
		version: SYNC_STATE_VERSION,
		last_synced_at: (deps.now?.() ?? new Date()).getTime(),
	}
	if (stop) return { kind: 'plan_limit', state: next, report: run.report, ...stop }
	return { kind: 'done', state: next, report: run.report }
}

/** Carries out one plan on both sides and keeps the base in step. */
class PassRun {
	readonly state: SyncState
	readonly report: SyncReport = {
		uploaded: 0,
		updated: 0,
		downloaded: 0,
		moved: 0,
		deleted: 0,
		trashed: 0,
		conflicts: [],
		skipped: [],
		errors: [],
	}
	/** The folder here as the actions leave it: moved, downloaded and trashed entries included. */
	readonly local: Map<string, LocalEntry>
	/** Relative path → current cloud path of every linked or new entry. */
	private readonly paths = new Map<string, string>([['', '/']])
	/** Names per cloud folder path, for conflicted copies. */
	private readonly names = new Map<string, Set<string>>()
	/** Entries whose base is read back from the cloud after the actions. */
	private readonly touched = new Set<string>()
	/** Entries whose pushed xattrs survive the action (an in-place update, a move). */
	private readonly keeps_xattrs = new Set<string>()
	/** Files whose bytes changed here this pass (an `update`): see `merge_entry_xattrs`. */
	private readonly rewritten_here = new Set<string>()
	private readonly cloud_by_id: Map<string, CloudEntry>
	private readonly deps: SyncPassDeps
	private last_save = 0

	constructor(deps: SyncPassDeps, state: SyncState, local: ReadonlyMap<string, LocalEntry>, cloud: readonly CloudEntry[]) {
		this.deps = deps
		this.local = new Map(local)
		this.state = { ...state, entries: { ...state.entries }, layout: { ...state.layout } }
		this.cloud_by_id = new Map(cloud.map(entry => [entry.id, entry]))
		for (const [relative, entry] of Object.entries(state.entries)) {
			const row = this.cloud_by_id.get(entry.cloud_id)
			if (row) this.paths.set(relative, row.path)
		}
		for (const entry of cloud) {
			if (entry.path === '/') continue
			this.names_in(cloud_parent(entry.path)).add(entry.name)
		}
	}

	private names_in(folder_path: string): Set<string> {
		let names = this.names.get(folder_path)
		if (!names) {
			names = new Set()
			this.names.set(folder_path, names)
		}
		return names
	}

	private get now(): Date {
		return this.deps.now?.() ?? new Date()
	}

	private absolute(relative: string): string {
		return join_local(this.deps.root, relative)
	}

	/** Saves the state so far: moves and deletes at once, content writes at most every 2 s. */
	private async checkpoint(structural: boolean): Promise<void> {
		const save = this.deps.save_progress
		if (!save) return
		const now = Date.now()
		if (!structural && now - this.last_save < PROGRESS_SAVE_MS) return
		this.last_save = now
		await save({ ...this.state, entries: { ...this.state.entries }, layout: { ...this.state.layout } })
	}

	/** Runs the actions in order; returns why the pass stopped early, if it did. */
	async apply(actions: readonly SyncAction[]): Promise<{ info: PlanLimitInfo; file: string } | null> {
		// bookkeeping (skip, adopt, forget) is instant: it does not count as progress
		const counts = (action: SyncAction) => action.kind !== 'skip' && action.kind !== 'adopt' && action.kind !== 'forget'
		const total = actions.filter(counts).length
		let done = 0
		const progress = (current: string | null) => this.deps.on_progress?.({ done, total, current })
		if (total > 0) progress(null)
		let failures = 0
		for (const action of actions) {
			if (action.kind === 'skip') {
				this.report.skipped.push({ relative: action.relative, reason: action.reason })
				continue
			}
			if (counts(action)) progress(action.relative)
			try {
				await this.apply_one(action)
				failures = 0
			} catch (error) {
				if (error instanceof PlanLimitError) return { info: error.to_info(), file: action.relative }
				this.report.errors.push({ relative: action.relative, message: message_of(error) })
				failures += 1
				if (failures >= FAILURES_IN_A_ROW) throw error
			} finally {
				if (counts(action)) {
					done += 1
					progress(null)
				}
			}
		}
		return null
	}

	private async apply_one(action: Exclude<SyncAction, { kind: 'skip' }>): Promise<void> {
		switch (action.kind) {
			case 'create_folder': {
				const parent = this.parent_path(action.relative)
				const created = await this.deps.cloud_fm.create_folder(parent, base_name(action.relative))
				this.landed(action.relative, created.id)
				return
			}
			case 'upload':
				await this.upload(action.relative)
				this.report.uploaded += 1
				return
			case 'update':
				await this.update(action.relative, action.cloud_id)
				this.report.updated += 1
				return
			case 'adopt': {
				const row = this.cloud_by_id.get(action.cloud_id)
				if (!row) throw new Error(`cloud entry is gone: ${action.relative}`)
				this.paths.set(action.relative, row.path)
				this.touched.add(action.relative)
				return
			}
			case 'move':
				await this.move(action.from, action.relative)
				this.report.moved += 1
				await this.checkpoint(true)
				return
			case 'delete': {
				const path = this.paths.get(action.relative)
				if (path) await this.deps.cloud_fm.remove(path)
				for (const relative of Object.keys(this.state.entries)) {
					if (!is_within(relative, action.relative)) continue
					if (this.state.entries[relative]!.kind === 'file') this.report.deleted += 1
					delete this.state.entries[relative]
					delete this.state.layout[relative]
				}
				this.forget_paths(action.relative)
				await this.checkpoint(true)
				return
			}
			case 'download_folder':
				await this.download_folder(action.relative, action.cloud_id)
				await this.checkpoint(true)
				return
			case 'download':
				await this.download(action.relative, action.cloud_id)
				this.report.downloaded += 1
				await this.checkpoint(false)
				return
			case 'local_move':
				await this.local_move(action.from, action.relative)
				this.report.moved += 1
				await this.checkpoint(true)
				return
			case 'local_trash':
				await this.local_trash(action.relative)
				await this.checkpoint(true)
				return
			case 'local_conflict':
				await this.local_conflict(action.relative, action.cloud_id)
				this.report.conflicts.push(action.relative)
				await this.checkpoint(true)
				return
			case 'forget':
				delete this.state.entries[action.relative]
				delete this.state.layout[action.relative]
		}
	}

	private local_entry(relative: string): LocalEntry {
		const entry = this.local.get(relative)
		if (!entry) throw new Error(`local entry is gone: ${relative}`)
		return entry
	}

	private parent_path(relative: string): string {
		const path = this.paths.get(parent_relative(relative))
		if (path === undefined) throw new Error(`parent folder is not in the cloud: ${relative}`)
		return path
	}

	private forget_paths(folder: string): void {
		for (const relative of [...this.paths.keys()]) {
			if (relative !== '' && is_within(relative, folder)) this.paths.delete(relative)
		}
	}

	private landed(relative: string, cloud_path: string): void {
		this.paths.set(relative, cloud_path)
		this.names_in(cloud_parent(cloud_path)).add(base_name(cloud_path))
		this.touched.add(relative)
	}

	// ---- here → cloud ------------------------------------------------------

	private async read(relative: string): Promise<{ blob: Blob; mime: string }> {
		const entry = this.local_entry(relative)
		const mime = upload_mime(entry.name)
		const read_blob = this.deps.read_blob ?? read_entry_blob
		return { blob: await read_blob(this.deps.local_fm, this.absolute(relative), entry.name, mime), mime }
	}

	private async upload(relative: string): Promise<void> {
		const entry = this.local_entry(relative)
		const parent = this.parent_path(relative)
		const { blob, mime } = await this.read(relative)
		// text over the column limit goes up as a binary file (as in the bridge)
		const type = is_text_mime(mime) && blob.size > MAX_TEXT_CONTENT_BYTES ? 'application/octet-stream' : mime
		const child = await this.deps.cloud_fm.upload_file(parent, entry.name, blob, type)
		this.landed(relative, child.id)
	}

	/**
	 * Text in the cloud's text column is saved in place. A binary file is
	 * replaced in place when the backend echoes `replace` (the id, the layout
	 * and the edges stay). Otherwise the old row is trashed and purged — the
	 * trash counts against the quota — and the new bytes go up under the same
	 * name, with a new id, so the layout and the folder's edges are pushed again.
	 */
	private async update(relative: string, cloud_id: string): Promise<void> {
		this.rewritten_here.add(relative)
		const row = this.cloud_by_id.get(cloud_id)
		const path = this.paths.get(relative) ?? row?.path
		if (!row || !path) throw new Error(`cloud entry is gone: ${relative}`)
		const { blob, mime } = await this.read(relative)
		if (!row.is_blob && is_text_mime(mime) && blob.size <= MAX_TEXT_CONTENT_BYTES) {
			const text = decode_text_content(new Uint8Array(await blob.arrayBuffer()))
			if (text !== null) {
				await this.deps.cloud_fm.save_text_file(path, text)
				this.paths.set(relative, path)
				this.touched.add(relative)
				this.keeps_xattrs.add(relative)
				return
			}
		}
		const type = is_text_mime(mime) && blob.size > MAX_TEXT_CONTENT_BYTES ? 'application/octet-stream' : mime
		if (this.deps.replace_blob) {
			const replaced = await this.deps.replace_blob(path, blob, type)
			if (replaced === 'replaced') {
				this.paths.set(relative, path)
				this.touched.add(relative)
				this.keeps_xattrs.add(relative)
				return
			}
		}
		await this.deps.cloud_fm.remove(path)
		try {
			await this.deps.purge(cloud_id)
		} catch (error) {
			console.error(error)
		}
		this.names_in(cloud_parent(path)).delete(base_name(path))
		await this.upload(relative)
		// the purge took the old row's edges along: they are not "deleted in
		// the cloud", they go up again with the new row
		this.forget_edges_of(relative)
	}

	private forget_edges_of(relative: string): void {
		const folder = this.state.layout[parent_relative(relative)]
		if (!folder?.connections) return
		const connections: Record<string, ConnectionBase> = {}
		for (const [key, known] of Object.entries(folder.connections)) {
			const [from, , to] = key.split('|')
			if (from !== relative && to !== relative) connections[key] = known
		}
		this.state.layout[parent_relative(relative)] = { ...folder, connections }
	}

	private async move(from: string, to: string): Promise<void> {
		const path = this.paths.get(from)
		if (!path) throw new Error(`cloud entry is gone: ${from}`)
		const target = this.parent_path(to)
		const name = base_name(to)
		// already there: an earlier pass moved it and stopped before saving
		const patch = path === join_cloud(target, name)
			? { id: path }
			: cloud_parent(path) === target
				? await this.deps.cloud_fm.rename(path, name)
				: await this.deps.cloud_fm.move(path, target, name)
		for (const [relative, cloud_path] of [...this.paths]) {
			if (relative === '' || !is_within(relative, from)) continue
			this.paths.delete(relative)
			this.paths.set(to + relative.slice(from.length), patch.id + cloud_path.slice(path.length))
		}
		this.rekey_state(from, to)
		this.names_in(cloud_parent(path)).delete(base_name(path))
		this.names_in(target).add(name)
		this.touched.add(to)
		this.keeps_xattrs.add(to)
	}

	private rekey_state(from: string, to: string): void {
		for (const relative of Object.keys(this.state.entries)) {
			if (!is_within(relative, from)) continue
			const moved = to + relative.slice(from.length)
			this.state.entries[moved] = this.state.entries[relative]!
			delete this.state.entries[relative]
			if (this.state.layout[relative]) {
				this.state.layout[moved] = this.state.layout[relative]!
				delete this.state.layout[relative]
			}
		}
	}

	// ---- cloud → here ------------------------------------------------------

	private cloud_row(relative: string, cloud_id: string): CloudEntry {
		const row = this.cloud_by_id.get(cloud_id)
		if (!row) throw new Error(`cloud entry is gone: ${relative}`)
		return row
	}

	private async local_xattrs(path: string): Promise<Record<string, string>> {
		return Object.fromEntries((await this.deps.local_fm.list_xattrs(path)).map(({ name, value }) => [name, value]))
	}

	private async write_xattrs(path: string, xattrs: Record<string, string>): Promise<void> {
		if (Object.keys(xattrs).length === 0) return
		const { missing } = await this.deps.local_fm.set_xattrs([{ id: path, xattrs }])
		if (missing.length > 0) throw new Error(`could not write the layout of ${path}`)
	}

	private async download_folder(relative: string, cloud_id: string): Promise<void> {
		const row = this.cloud_row(relative, cloud_id)
		const path = this.absolute(relative)
		if (!this.local.has(relative)) {
			await this.deps.local_fm.create_folder(this.absolute(parent_relative(relative)), base_name(relative), {
				xattrs: row.xattrs,
			})
		}
		this.local.set(relative, { relative, id: path, name: base_name(relative), kind: 'folder', size: 0, mtime_ms: 0, bad_name: false })
		this.paths.set(relative, row.path)
		this.state.entries[relative] = {
			kind: 'folder',
			size: 0,
			mtime_ms: 0,
			cloud_id: row.id,
			cloud_modified_at: row.modified_at,
			xattrs: { ...row.xattrs },
		}
	}

	/**
	 * The cloud bytes come down under `relative`: written beside the target
	 * and renamed over it, then the xattrs (a file it replaces keeps its own
	 * layout, a new file gets the cloud row's), then a stat — the base records
	 * the file as the write left it, so the next pass sees no change here.
	 */
	private async download(relative: string, cloud_id: string): Promise<void> {
		const row = this.cloud_row(relative, cloud_id)
		const path = this.absolute(relative)
		const read_blob = this.deps.read_blob ?? read_entry_blob
		const blob = await read_blob(this.deps.cloud_fm, row.path, row.name, upload_mime(row.name))
		const replaced = this.local.get(relative)
		const known = this.state.entries[relative]
		const xattrs = replaced?.kind === 'file' ? await this.local_xattrs(path) : row.xattrs
		await this.deps.writer.write_file(this.absolute(parent_relative(relative)), base_name(relative), blob)
		await this.write_xattrs(path, xattrs)
		const info = await this.deps.stat(path)
		this.local.set(relative, {
			relative,
			id: path,
			name: base_name(relative),
			kind: 'file',
			size: info.size,
			mtime_ms: info.mtime_ms,
			bad_name: false,
		})
		this.paths.set(relative, row.path)
		const next: BaseEntry = {
			kind: 'file',
			size: info.size,
			mtime_ms: info.mtime_ms,
			cloud_id: row.id,
			cloud_modified_at: row.modified_at,
		}
		// a new file holds the cloud layout; a replaced one keeps the base of its own
		if (!replaced) next.xattrs = { ...xattrs }
		else {
			if (known?.xattrs) next.xattrs = known.xattrs
			if (known?.xattrs_hash !== undefined) next.xattrs_hash = known.xattrs_hash
		}
		this.state.entries[relative] = next
	}

	/** The entry here follows its cloud row; the local file manager also rebases the folder's edges. */
	private async local_move(from: string, to: string): Promise<void> {
		const source = this.absolute(from)
		const name = base_name(to)
		if (parent_relative(from) === parent_relative(to)) await this.deps.local_fm.rename(source, name)
		else await this.deps.local_fm.move(source, this.absolute(parent_relative(to)), name)
		for (const [relative, entry] of [...this.local]) {
			if (!is_within(relative, from)) continue
			const moved = to + relative.slice(from.length)
			this.local.delete(relative)
			this.local.set(moved, { ...entry, relative: moved, id: this.absolute(moved), name: base_name(moved) })
		}
		for (const [relative, cloud_path] of [...this.paths]) {
			if (relative === '' || !is_within(relative, from)) continue
			this.paths.delete(relative)
			this.paths.set(to + relative.slice(from.length), cloud_path)
		}
		this.rekey_state(from, to)
	}

	/** Only ever inside the synced folder, never the folder itself or a `.pile` sidecar. */
	private async local_trash(relative: string): Promise<void> {
		if (relative === '' || relative.split('/').includes(PILE_DIR_NAME)) {
			throw new Error(`refusing to trash ${relative || 'the synced folder'}`)
		}
		await this.deps.writer.trash(this.absolute(relative))
		for (const key of [...this.local.keys()]) {
			if (is_within(key, relative)) this.local.delete(key)
		}
		for (const key of Object.keys(this.state.entries)) {
			if (!is_within(key, relative)) continue
			if (this.state.entries[key]!.kind === 'file') this.report.trashed += 1
			delete this.state.entries[key]
			delete this.state.layout[key]
		}
		this.forget_paths(relative)
	}

	/**
	 * Changed on both sides: the cloud version keeps the name. The local file
	 * is renamed to a conflicted copy here, goes up as a new cloud file, and
	 * the cloud version comes down under the name.
	 */
	private async local_conflict(relative: string, cloud_id: string): Promise<void> {
		const entry = this.local_entry(relative)
		const parent = parent_relative(relative)
		const taken = new Set([
			...[...this.local.keys()].filter(key => parent_relative(key) === parent).map(base_name),
			...this.names_in(this.paths.get(parent) ?? '/'),
		])
		const copy_name = conflicted_name(entry.name, this.now, taken)
		const copy = parent ? `${parent}/${copy_name}` : copy_name
		await this.deps.local_fm.rename(this.absolute(relative), copy_name)
		// the copy's base comes from the file as it is now, not from the scan
		const info = await this.deps.stat(this.absolute(copy))
		this.local.delete(relative)
		this.local.set(copy, { ...entry, relative: copy, id: this.absolute(copy), name: copy_name, ...info })
		// the name is gone here: drop its link and save at once. Interrupted
		// before the download, the next pass then brings the cloud version
		// down and sends the copy up, instead of reading "deleted here,
		// unchanged in the cloud" and trashing the cloud version
		delete this.state.entries[relative]
		await this.checkpoint(true)
		await this.upload(copy)
		await this.download(relative, cloud_id)
	}

	/** The new base of every touched entry: local size and mtime, the cloud row as it is now. */
	refresh(cloud: readonly CloudEntry[]): void {
		const by_path = new Map(cloud.map(entry => [entry.path, entry]))
		for (const relative of this.touched) {
			const path = this.paths.get(relative)
			const row = path === undefined ? undefined : by_path.get(path)
			const entry = this.local.get(relative)
			if (!row || !entry) continue
			const known = this.state.entries[relative]
			const next: BaseEntry = {
				kind: entry.kind,
				size: entry.size,
				mtime_ms: entry.mtime_ms,
				cloud_id: row.id,
				cloud_modified_at: row.modified_at,
			}
			if (known && this.keeps_xattrs.has(relative)) {
				if (known.xattrs) next.xattrs = known.xattrs
				if (known.xattrs_hash !== undefined) next.xattrs_hash = known.xattrs_hash
			}
			this.state.entries[relative] = next
		}
	}

	/**
	 * Three-way merge of the layout (layoutSync.ts): xattrs per entry, then
	 * ink and edges per folder. Writes go to both sides; the base keeps only
	 * what is known to hold on both — a local sidecar write is read back, and
	 * what a board wrote over is left for the next pass
	 */
	async merge_layout(
		layout: LocalLayout,
		folders: readonly string[],
		cloud: readonly CloudEntry[],
		cloud_layout: { strokes: StrokeRow[]; connections: ConnectionRow[] },
	): Promise<void> {
		const by_id = new Map(cloud.map(entry => [entry.id, entry]))
		const root_row = cloud.find(entry => entry.path === '/')
		const row_of = (relative: string): CloudEntry | undefined => {
			if (relative === '') return root_row
			const known = this.state.entries[relative]
			return known ? by_id.get(known.cloud_id) : undefined
		}
		await this.merge_entry_xattrs(layout, row_of)

		// ink and edges of live folders only: a trashed folder keeps its rows
		const strokes_by_folder = new Map<string, FolderStroke[]>()
		for (const row of cloud_layout.strokes) {
			if (by_id.get(row.entry_id)?.kind !== 'folder') continue
			const { entry_id, workspace_id: _workspace, updated_by_client: _client, ...stroke } = row
			strokes_by_folder.set(entry_id, [...(strokes_by_folder.get(entry_id) ?? []), stroke])
		}
		const edges_by_folder = new Map<string, FolderConnection[]>()
		for (const row of cloud_layout.connections) {
			const from = by_id.get(row.from_entry)
			const to = by_id.get(row.to_entry)
			if (by_id.get(row.entry_id)?.kind !== 'folder' || !from || !to) continue
			const label = row.props?.label
			edges_by_folder.set(row.entry_id, [...(edges_by_folder.get(row.entry_id) ?? []), {
				id: row.id,
				from: cloud_relative(from.path),
				to: cloud_relative(to.path),
				from_handle: row.props?.from_handle ?? undefined,
				to_handle: row.props?.to_handle ?? undefined,
				marker_start: row.props?.marker_start ?? undefined,
				marker_end: row.props?.marker_end ?? undefined,
				is_animated: row.props?.is_animated ?? false,
				...(label ? { label } : {}),
			}])
		}
		const in_cloud = new Set(cloud.map(entry => cloud_relative(entry.path)))
		const here = (relative: string) => relative === '' || this.local.has(relative)

		for (const relative of folders) {
			const folder = layout.folders.get(relative)
			const row = row_of(relative)
			if (!folder || !row) continue
			const known = this.state.layout[relative] ?? {}
			try {
				const strokes = await this.merge_folder_strokes(relative, row, folder, known, strokes_by_folder.get(row.id) ?? [])
				const connections = await this.merge_folder_edges(
					relative,
					row,
					folder,
					known,
					edges_by_folder.get(row.id) ?? [],
					end => here(end) && in_cloud.has(end),
				)
				this.state.layout[relative] = { strokes, connections }
			} catch (error) {
				this.report.errors.push({ relative, message: message_of(error) })
			}
		}
	}

	private async merge_entry_xattrs(layout: LocalLayout, row_of: (relative: string) => CloudEntry | undefined): Promise<void> {
		const local_sets: { id: string; xattrs: Record<string, string> }[] = []
		const local_removes: { path: string; name: string }[] = []
		const cloud_sets: { id: string; xattrs: Record<string, string> }[] = []
		const cloud_removes: { path: string; name: string }[] = []
		const merged = new Map<string, Record<string, string>>()
		const linked = ['', ...Object.keys(this.state.entries).filter(relative => this.local.has(relative))]
		for (const relative of linked) {
			const row = row_of(relative)
			if (!row) continue
			const on_disk = layout.xattrs.get(relative) ?? {}
			const entry = relative === '' ? undefined : this.state.entries[relative]
			const known = relative === ''
				? this.state.root_xattrs ?? lift_v1_xattrs(this.state.root_xattrs_hash, on_disk)
				: entry?.xattrs ?? lift_v1_xattrs(entry?.xattrs_hash, on_disk)
			// An app that saves by writing a new file (Preview, most editors)
			// drops the xattrs with the old one. For a file rewritten here, a
			// missing key was lost, not removed: it is restored, not removed in
			// the cloud — where a board would fill in defaults and send them back
			const local = known && this.rewritten_here.has(relative) ? { ...known, ...on_disk } : on_disk
			const merge = merge_xattrs(known, local, row.xattrs)
			const path = this.absolute(relative)
			// what to write here is measured against the disk, restored keys included
			const sets_here: Record<string, string> = {}
			for (const [name, value] of Object.entries(merge.merged)) {
				if (on_disk[name] !== value) sets_here[name] = value
			}
			if (Object.keys(sets_here).length > 0) local_sets.push({ id: path, xattrs: sets_here })
			for (const name of Object.keys(on_disk)) {
				if (!(name in merge.merged)) local_removes.push({ path, name })
			}
			if (Object.keys(merge.cloud_sets).length > 0) cloud_sets.push({ id: row.path, xattrs: merge.cloud_sets })
			for (const name of merge.cloud_removes) cloud_removes.push({ path: row.path, name })
			merged.set(relative, merge.merged)
		}

		const failed = new Set<string>()
		const local_failed = new Set<string>()
		if (local_sets.length > 0) {
			for (const path of (await this.deps.local_fm.set_xattrs(local_sets)).missing) local_failed.add(path)
		}
		for (const removal of local_removes) {
			try {
				await this.deps.local_fm.remove_xattr(removal.path, removal.name)
			} catch {
				local_failed.add(removal.path)
			}
		}
		if (cloud_sets.length > 0) {
			for (const path of (await this.deps.cloud_fm.set_xattrs(cloud_sets)).missing) failed.add(path)
		}
		for (const removal of cloud_removes) {
			try {
				await this.deps.cloud_fm.remove_xattr(removal.path, removal.name)
			} catch {
				failed.add(removal.path)
			}
		}
		for (const [relative, values] of merged) {
			const row = row_of(relative)
			if (!row || failed.has(row.path) || local_failed.has(this.absolute(relative))) continue
			if (relative === '') {
				this.state.root_xattrs = values
				delete this.state.root_xattrs_hash
			} else {
				const { xattrs_hash: _legacy, ...entry } = this.state.entries[relative]!
				this.state.entries[relative] = { ...entry, xattrs: values }
			}
		}
	}

	private async merge_folder_strokes(
		relative: string,
		row: CloudEntry,
		folder: LocalFolderLayout,
		known: BaseFolderLayout,
		cloud: readonly FolderStroke[],
	): Promise<Record<string, StrokeBase>> {
		const workspace_id = this.state.workspace_id
		const base = known.strokes ?? await lift_v1_strokes(workspace_id, known.strokes_hash, folder.legacy.strokes_hash, folder.strokes)
		const merge = await merge_strokes(workspace_id, base, folder.strokes, cloud, this.now.getTime())
		const cloud_store = this.deps.cloud_fm.strokes
		if (merge.cloud_upserts.length > 0) await cloud_store.upsert_strokes(row.path, merge.cloud_upserts)
		if (merge.cloud_deletes.length > 0) await cloud_store.delete_strokes(row.path, merge.cloud_deletes)
		if (merge.local_upserts.length === 0 && merge.local_deletes.length === 0) return merge.next

		const path = this.absolute(relative)
		const local_store = this.deps.local_fm.strokes
		if (merge.local_upserts.length > 0) await local_store.upsert_strokes(path, merge.local_upserts)
		if (merge.local_deletes.length > 0) await local_store.delete_strokes(path, merge.local_deletes)
		// read back: a board may have written its own sidecar over ours
		const on_disk = new Map((await local_store.list_strokes(path)).map(stroke => [stroke.id, stroke_hash(stroke)]))
		const next = { ...merge.next }
		for (const cloud_id of merge.written_here) {
			const written = next[cloud_id]!
			if (on_disk.get(written.local_id) === written.hash) continue
			if (base[cloud_id]) next[cloud_id] = base[cloud_id]!
			else delete next[cloud_id]
		}
		const cloud_id_of = new Map(Object.entries(base).map(([cloud_id, stroke]) => [stroke.local_id, cloud_id]))
		for (const local_id of merge.local_deletes) {
			const cloud_id = cloud_id_of.get(local_id)
			// still here: kept in the base, so the next pass deletes it again
			if (cloud_id && on_disk.has(local_id) && base[cloud_id]) next[cloud_id] = base[cloud_id]!
		}
		return next
	}

	/**
	 * Edges count only when both ends are on both sides: an edge to a file
	 * that does not go up (too large, left out) must not look deleted in the
	 * cloud. Its base is carried over untouched
	 */
	private async merge_folder_edges(
		relative: string,
		row: CloudEntry,
		folder: LocalFolderLayout,
		known: BaseFolderLayout,
		cloud: readonly FolderConnection[],
		syncable_end: (relative: string) => boolean,
	): Promise<Record<string, ConnectionBase>> {
		const syncable = (edge: FolderConnection) => syncable_end(edge.from) && syncable_end(edge.to)
		const local = folder.connections.filter(syncable)
		const lifted = known.connections ?? lift_v1_connections(known.connections_hash, folder.legacy.connections_hash, folder.connections)
		const base: Record<string, ConnectionBase> = {}
		const carried: Record<string, ConnectionBase> = {}
		for (const [key, value] of Object.entries(lifted)) {
			const [from, , to] = key.split('|')
			if (syncable_end(from!) && syncable_end(to!)) base[key] = value
			else carried[key] = value
		}
		const merge = merge_connections(base, local, cloud.filter(syncable), this.now.getTime())

		const handle = (value: string | undefined) => value ?? 'default'
		const cloud_path = (end: string) => (end === '' ? '/' : `/${end}`)
		if (merge.cloud_upserts.length > 0) {
			await this.deps.cloud_fm.connections.upsert_connections(row.path, merge.cloud_upserts.map((edge) => {
				const from = cloud_path(edge.from)
				const to = cloud_path(edge.to)
				return { ...edge, id: `${from}:${handle(edge.from_handle)}-${to}:${handle(edge.to_handle)}`, from, to }
			}))
		}
		if (merge.cloud_deletes.length > 0) await this.deps.cloud_fm.connections.delete_connections(row.path, merge.cloud_deletes)
		const next = { ...carried, ...merge.next }
		if (merge.local_upserts.length === 0 && merge.local_deletes.length === 0) return next

		// here: absolute ends and the board's own deterministic ids, so reading
		// the sidecar does not "heal" (rewrite) it
		const path = this.absolute(relative)
		const local_store = this.deps.local_fm.connections
		if (merge.local_upserts.length > 0) {
			await local_store.upsert_connections(path, merge.local_upserts.map((edge) => {
				const from = this.absolute(edge.from)
				const to = this.absolute(edge.to)
				return { ...edge, id: `${from}:${handle(edge.from_handle)}-${to}:${handle(edge.to_handle)}`, from, to }
			}))
		}
		if (merge.local_deletes.length > 0) await local_store.delete_connections(path, merge.local_deletes)
		const on_disk = new Map<string, string>()
		for (const edge of await local_store.list_connections(path)) {
			const from = relative_of(this.deps.root, edge.from)
			const to = relative_of(this.deps.root, edge.to)
			if (from !== null && to !== null) on_disk.set(connection_key({ ...edge, from, to }), connection_hash(edge))
		}
		for (const key of merge.written_here) {
			if (on_disk.get(key) === next[key]!.hash) continue
			if (base[key]) next[key] = base[key]!
			else delete next[key]
		}
		for (const edge of local) {
			const key = connection_key(edge)
			if (merge.local_deletes.includes(edge.id) && on_disk.has(key) && base[key]) next[key] = base[key]!
		}
		return next
	}
}

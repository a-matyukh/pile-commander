import type { FileManager, FolderConnection, FolderStroke, PlanLimitInfo } from '@pile-commander/file-manager'
import { MAX_TEXT_CONTENT_BYTES, PlanLimitError, decode_text_content, is_text_mime } from '@pile-commander/file-manager'
import { read_entry_blob, upload_mime } from '@/services/workspace/entryBytes'
import { derived_uuid, hash_value } from './hash'
import { read_local_layout, scan_local, type LocalLayout, type LocalStat } from './localScan'
import { base_name, depth, is_within, join_cloud, join_local, parent_relative } from './paths'
import { partition_local, reconcile, type ReconcileOptions } from './reconcile'
import type { BaseEntry, BaseFolderLayout, CloudEntry, LocalEntry, SkipReason, SyncAction, SyncState } from './types'

export type SyncPassDeps = {
	local_fm: FileManager
	/** The synced folder's absolute path. */
	root: string
	stat: LocalStat
	/** File manager of the linked cloud workspace. */
	cloud_fm: FileManager
	/** Every live entry of the linked workspace. */
	list_cloud(): Promise<CloudEntry[]>
	/** Hard-deletes a trashed cloud entry by id. */
	purge(cloud_id: string): Promise<void>
	read_blob?: (fm: FileManager, id: string, name: string, mime: string) => Promise<Blob>
	/**
	 * Replaces a cloud file's bytes in place. Absent, or `'unsupported'`,
	 * means this backend cannot: the pass falls back to trash, purge, upload.
	 */
	replace_blob?: (cloud_path: string, blob: Blob, mime: string) => Promise<'replaced' | 'unsupported'>
	now?: () => Date
}

export type SyncPassOptions = {
	max_file_bytes: number
	/** The person confirmed that a large share of the cloud copy goes to the trash. */
	allow_mass_delete?: boolean
}

export type SyncReport = {
	uploaded: number
	updated: number
	moved: number
	deleted: number
	/** Relative paths that went up as conflicted copies. */
	conflicts: string[]
	skipped: { relative: string; reason: SkipReason }[]
	/** Actions that failed this pass; they are retried on the next one. */
	errors: { relative: string; message: string }[]
}

export type SyncPassResult =
	/** Nothing changed here since the last pass: the cloud was not even asked. */
	| { kind: 'unchanged'; skipped: SyncReport['skipped'] }
	| { kind: 'done'; state: SyncState; report: SyncReport }
	/** The pass would trash much of the cloud copy (a folder emptied or unmounted). */
	| { kind: 'mass_delete'; deletes: number; base_files: number }
	/** The plan refused a file; what went up before it is kept in `state`. */
	| { kind: 'plan_limit'; state: SyncState; report: SyncReport; info: PlanLimitInfo; file: string }

/** A pass that would trash at least this many files and over half the copy asks first. */
export const MASS_DELETE_MIN = 20

/** Failures in a row that end a pass: the network is gone, not one file. */
const FAILURES_IN_A_ROW = 3

const EMPTY_FOLDER_LAYOUT: BaseFolderLayout = {
	strokes_hash: hash_value([]),
	connections_hash: hash_value([]),
}

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
	if (hash_value(layout.xattrs.get('') ?? {}) !== (state.root_xattrs_hash ?? hash_value({}))) return true
	for (const [relative, known] of Object.entries(state.entries)) {
		if (!local.has(relative)) continue
		if (hash_value(layout.xattrs.get(relative) ?? {}) !== (known.xattrs_hash ?? hash_value({}))) return true
	}
	for (const [relative, folder] of layout.folders) {
		const known = state.layout[relative] ?? EMPTY_FOLDER_LAYOUT
		if (known.strokes_hash !== folder.hashes.strokes_hash) return true
		if (known.connections_hash !== folder.hashes.connections_hash) return true
	}
	return false
}

/**
 * One local → cloud pass over a linked folder. Reads the folder first and
 * stops right there when nothing changed since the base; otherwise lists the
 * cloud workspace, reconciles (reconcile.ts), carries the actions out, reads
 * the cloud back for the new base and pushes the layout. Returns the next
 * state; the caller persists it.
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
	const folders = ['', ...[...local.values()].filter(entry => entry.kind === 'folder').map(entry => entry.relative)]
	const layout = await read_local_layout(deps.local_fm, deps.root, folders)
	if (!has_local_changes(state, local, skipped, layout)) return { kind: 'unchanged', skipped: skipped_report }

	const cloud_before = await deps.list_cloud()
	const plan = reconcile(state.entries, scanned, cloud_before, reconcile_options)
	if (!options.allow_mass_delete && plan.deletes >= MASS_DELETE_MIN && plan.deletes * 2 > plan.base_files) {
		return { kind: 'mass_delete', deletes: plan.deletes, base_files: plan.base_files }
	}

	const run = new PassRun(deps, state, local, cloud_before)
	const stop = await run.apply(plan.actions)
	const cloud_after = await deps.list_cloud()
	run.refresh(cloud_after)
	if (!stop) await run.push_layout(layout, folders, cloud_after)
	const next: SyncState = { ...run.state, last_synced_at: (deps.now?.() ?? new Date()).getTime() }
	if (stop) return { kind: 'plan_limit', state: next, report: run.report, ...stop }
	return { kind: 'done', state: next, report: run.report }
}

/** Carries out one plan against the cloud and keeps the base in step. */
class PassRun {
	readonly state: SyncState
	readonly report: SyncReport = { uploaded: 0, updated: 0, moved: 0, deleted: 0, conflicts: [], skipped: [], errors: [] }
	/** Relative path → current cloud path of every linked or new entry. */
	private readonly paths = new Map<string, string>([['', '/']])
	/** Names per cloud folder path, for conflicted copies. */
	private readonly names = new Map<string, Set<string>>()
	/** Entries whose base is read back from the cloud after the actions. */
	private readonly touched = new Set<string>()
	/** Entries whose pushed xattrs survive the action (an in-place update, a move). */
	private readonly keeps_xattrs = new Set<string>()
	private readonly cloud_by_id: Map<string, CloudEntry>
	private readonly deps: SyncPassDeps
	private readonly local: ReadonlyMap<string, LocalEntry>

	constructor(deps: SyncPassDeps, state: SyncState, local: ReadonlyMap<string, LocalEntry>, cloud: readonly CloudEntry[]) {
		this.deps = deps
		this.local = local
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

	/** Runs the actions in order; returns why the pass stopped early, if it did. */
	async apply(actions: readonly SyncAction[]): Promise<{ info: PlanLimitInfo; file: string } | null> {
		let failures = 0
		for (const action of actions) {
			if (action.kind === 'skip') {
				this.report.skipped.push({ relative: action.relative, reason: action.reason })
				continue
			}
			try {
				await this.apply_one(action)
				failures = 0
			} catch (error) {
				if (error instanceof PlanLimitError) return { info: error.to_info(), file: action.relative }
				this.report.errors.push({ relative: action.relative, message: message_of(error) })
				failures += 1
				if (failures >= FAILURES_IN_A_ROW) throw error
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
			case 'conflict': {
				const entry = this.local_entry(action.relative)
				const parent = this.parent_path(action.relative)
				await this.upload(action.relative, conflicted_name(entry.name, this.now, this.names_in(parent)))
				this.report.conflicts.push(action.relative)
				return
			}
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
				for (const relative of [...this.paths.keys()]) {
					if (relative !== '' && is_within(relative, action.relative)) this.paths.delete(relative)
				}
				return
			}
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

	private landed(relative: string, cloud_path: string): void {
		this.paths.set(relative, cloud_path)
		this.names_in(cloud_parent(cloud_path)).add(base_name(cloud_path))
		this.touched.add(relative)
	}

	private async read(entry: LocalEntry): Promise<{ blob: Blob; mime: string }> {
		const mime = upload_mime(entry.name)
		const read_blob = this.deps.read_blob ?? read_entry_blob
		return { blob: await read_blob(this.deps.local_fm, entry.id, entry.name, mime), mime }
	}

	private async upload(relative: string, name?: string): Promise<void> {
		const entry = this.local_entry(relative)
		const parent = this.parent_path(relative)
		const { blob, mime } = await this.read(entry)
		// text over the column limit goes up as a binary file (as in the bridge)
		const type = is_text_mime(mime) && blob.size > MAX_TEXT_CONTENT_BYTES ? 'application/octet-stream' : mime
		const child = await this.deps.cloud_fm.upload_file(parent, name ?? entry.name, blob, type)
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
		const entry = this.local_entry(relative)
		const row = this.cloud_by_id.get(cloud_id)
		const path = this.paths.get(relative) ?? row?.path
		if (!row || !path) throw new Error(`cloud entry is gone: ${relative}`)
		const { blob, mime } = await this.read(entry)
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
		delete this.state.layout[parent_relative(relative)]
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
		this.names_in(cloud_parent(path)).delete(base_name(path))
		this.names_in(target).add(name)
		this.touched.add(to)
		this.keeps_xattrs.add(to)
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
			if (known?.xattrs_hash !== undefined && this.keeps_xattrs.has(relative)) next.xattrs_hash = known.xattrs_hash
			this.state.entries[relative] = next
		}
	}

	/**
	 * Makes the cloud layout match the local one where the local one changed:
	 * xattrs per entry, then ink and edges per folder. The first push of an
	 * entry only adds and overwrites keys; later pushes also remove the keys
	 * removed here
	 */
	async push_layout(layout: LocalLayout, folders: readonly string[], cloud: readonly CloudEntry[]): Promise<void> {
		const by_id = new Map(cloud.map(entry => [entry.id, entry]))
		const root_row = cloud.find(entry => entry.path === '/')
		const row_of = (relative: string): CloudEntry | undefined => {
			if (relative === '') return root_row
			const known = this.state.entries[relative]
			return known ? by_id.get(known.cloud_id) : undefined
		}

		const sets: { id: string; xattrs: Record<string, string> }[] = []
		const removals: { path: string; name: string }[] = []
		const hashes = new Map<string, string>()
		const linked = ['', ...Object.keys(this.state.entries).filter(relative => this.local.has(relative))]
		for (const relative of linked) {
			const local = layout.xattrs.get(relative) ?? {}
			const hash = hash_value(local)
			const before = relative === '' ? this.state.root_xattrs_hash : this.state.entries[relative]?.xattrs_hash
			// never pushed and nothing to push: the cloud keeps what it has
			if (before === undefined ? Object.keys(local).length === 0 : hash === before) continue
			const row = row_of(relative)
			if (!row) continue
			const changed: Record<string, string> = {}
			for (const [name, value] of Object.entries(local)) {
				if (row.xattrs[name] !== value) changed[name] = value
			}
			if (Object.keys(changed).length > 0) sets.push({ id: row.path, xattrs: changed })
			if (before !== undefined) {
				for (const name of Object.keys(row.xattrs)) {
					if (!(name in local)) removals.push({ path: row.path, name })
				}
			}
			hashes.set(relative, hash)
		}
		const missing = new Set(sets.length > 0 ? (await this.deps.cloud_fm.set_xattrs(sets)).missing : [])
		const failed = new Set<string>(missing)
		for (const removal of removals) {
			try {
				await this.deps.cloud_fm.remove_xattr(removal.path, removal.name)
			} catch {
				failed.add(removal.path)
			}
		}
		for (const [relative, hash] of hashes) {
			const row = row_of(relative)
			if (!row || failed.has(row.path)) continue
			if (relative === '') this.state.root_xattrs_hash = hash
			else this.state.entries[relative] = { ...this.state.entries[relative]!, xattrs_hash: hash }
		}

		const by_depth = [...folders].sort((a, b) => depth(a) - depth(b))
		for (const relative of by_depth) {
			const folder = layout.folders.get(relative)
			const row = row_of(relative)
			if (!folder || !row) continue
			const before = this.state.layout[relative] ?? EMPTY_FOLDER_LAYOUT
			try {
				if (before.strokes_hash !== folder.hashes.strokes_hash) {
					await this.push_strokes(row.path, folder.strokes)
				}
				if (before.connections_hash !== folder.hashes.connections_hash) {
					await this.push_connections(row.path, folder.connections, by_id)
				}
				this.state.layout[relative] = folder.hashes
			} catch (error) {
				this.report.errors.push({ relative, message: message_of(error) })
			}
		}
	}

	private async push_strokes(folder_path: string, strokes: readonly FolderStroke[]): Promise<void> {
		const strokes_store = this.deps.cloud_fm.strokes
		const mapped = await Promise.all(strokes.map(async stroke => ({
			...stroke,
			id: await derived_uuid(this.state.workspace_id, stroke.id),
		})))
		if (mapped.length > 0) await strokes_store.upsert_strokes(folder_path, mapped)
		const keep = new Set(mapped.map(stroke => stroke.id))
		const stale = (await strokes_store.list_strokes(folder_path)).filter(stroke => !keep.has(stroke.id))
		if (stale.length > 0) await strokes_store.delete_strokes(folder_path, stale.map(stroke => stroke.id))
	}

	/** Edges with root-relative endpoints, rebased onto the cloud paths of their ends. */
	private async push_connections(
		folder_path: string,
		edges: readonly FolderConnection[],
		by_id: ReadonlyMap<string, CloudEntry>,
	): Promise<void> {
		const store = this.deps.cloud_fm.connections
		const cloud_path = (relative: string): string | undefined => {
			if (relative === '') return '/'
			const known = this.state.entries[relative]
			return known ? by_id.get(known.cloud_id)?.path : undefined
		}
		const handle = (value: string | undefined) => value ?? 'default'
		const mapped: FolderConnection[] = []
		for (const edge of edges) {
			const from = cloud_path(edge.from)
			const to = cloud_path(edge.to)
			if (!from || !to) continue
			const local_id = `${join_local(this.deps.root, edge.from)}:${handle(edge.from_handle)}-${join_local(this.deps.root, edge.to)}:${handle(edge.to_handle)}`
			const id = edge.id === local_id ? `${from}:${handle(edge.from_handle)}-${to}:${handle(edge.to_handle)}` : edge.id
			mapped.push({ ...edge, id, from, to })
		}
		if (mapped.length > 0) await store.upsert_connections(folder_path, mapped)
		const keep = new Set(mapped.map(edge => edge.id))
		const stale = (await store.list_connections(folder_path)).filter(edge => !keep.has(edge.id))
		if (stale.length > 0) await store.delete_connections(folder_path, stale.map(edge => edge.id))
	}
}

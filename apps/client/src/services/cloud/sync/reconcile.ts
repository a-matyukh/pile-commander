import { base_name, depth, is_within, join_cloud, parent_relative } from './paths'
import type { BaseEntry, CloudEntry, LocalEntry, SkipReason, SyncAction, SyncPlan } from './types'

export type ReconcileOptions = {
	/** Relative paths the person left out. */
	exclude: ReadonlySet<string>
	/** The plan's per-file limit. */
	max_file_bytes: number
	/** See SyncState.adopt_before. */
	adopt_before?: number
}

/** Why a local entry takes no part in this pass, or null. */
export function skip_reason(entry: LocalEntry, options: Pick<ReconcileOptions, 'exclude' | 'max_file_bytes'>): SkipReason | null {
	if (entry.bad_name) return 'bad_name'
	if (options.exclude.has(entry.relative)) return 'excluded'
	if (entry.kind === 'file' && entry.size > options.max_file_bytes) return 'too_large'
	return null
}

export type LocalPartition = {
	/** Entries that take part in the pass, by relative path. */
	local: Map<string, LocalEntry>
	/** Entries left out, with their whole subtree. */
	skipped: Set<string>
	skips: SyncAction[]
}

/** Splits a scan (parents before children) into the entries that sync and the ones left out. */
export function partition_local(
	local_entries: readonly LocalEntry[],
	options: Pick<ReconcileOptions, 'exclude' | 'max_file_bytes'>,
): LocalPartition {
	const skips: SyncAction[] = []
	const skipped = new Set<string>()
	const local = new Map<string, LocalEntry>()
	for (const entry of local_entries) {
		const parent = parent_relative(entry.relative)
		const reason = skip_reason(entry, options)
			?? (parent !== '' && skipped.has(parent) ? 'parent_skipped' : null)
		if (reason) {
			skipped.add(entry.relative)
			skips.push({ kind: 'skip', relative: entry.relative, reason })
			continue
		}
		local.set(entry.relative, entry)
	}
	return { local, skipped, skips }
}

function is_local_change(local: LocalEntry, base: BaseEntry): boolean {
	return local.size !== base.size || local.mtime_ms !== base.mtime_ms
}

function is_cloud_change(cloud: CloudEntry, base: BaseEntry): boolean {
	return base.kind === 'file' && cloud.modified_at !== base.cloud_modified_at
}

/** Moves the base entries of `from` (and everything below it) under `to`. */
function rekey(base: Map<string, BaseEntry>, from: string, to: string): void {
	for (const [relative, entry] of [...base]) {
		if (!is_within(relative, from)) continue
		base.delete(relative)
		base.set(to + relative.slice(from.length), entry)
	}
}

/**
 * Plans one local → cloud pass from the base, the folder on disk and the
 * cloud listing. Pure: no I/O, the executor carries the actions out.
 *
 * - new here → created in the cloud, or adopted when the cloud already holds
 *   the same thing at that path (a linked earlier copy, a resumed first pass);
 * - edited here → the cloud row is updated, unless it changed there too: then
 *   the local version goes up as a conflicted copy and the cloud one stays;
 * - deleted here → the cloud row goes to the trash when it is unchanged
 *   there; a folder only when nothing in it would be lost;
 * - renamed or moved here (the same size and mtime under a new path, a
 *   folder whose files all moved along) → the cloud row follows, keeping its
 *   id, layout and edges;
 * - changes made only in the cloud are left alone (one-way sync).
 */
export function reconcile(
	base_record: Readonly<Record<string, BaseEntry>>,
	local_entries: readonly LocalEntry[],
	cloud_entries: readonly CloudEntry[],
	options: ReconcileOptions,
): SyncPlan {
	const base = new Map(Object.entries(base_record))
	const base_files = [...base.values()].filter(entry => entry.kind === 'file').length
	const cloud_by_id = new Map(cloud_entries.map(entry => [entry.id, entry]))
	const cloud_by_path = new Map(cloud_entries.map(entry => [entry.path, entry]))

	const { local, skipped, skips } = partition_local(local_entries, options)
	// a skipped entry is neither pushed nor deleted: its base stays as it was
	const is_gone = (relative: string) => !local.has(relative) && !skipped.has(relative)

	// ---- renames and moves ------------------------------------------------
	const moves: Extract<SyncAction, { kind: 'move' }>[] = []
	const moved_to = new Set<string>()

	const unchanged_cloud = (entry: BaseEntry): CloudEntry | null => {
		const cloud = cloud_by_id.get(entry.cloud_id)
		return cloud && !is_cloud_change(cloud, entry) ? cloud : null
	}

	// folders first, shallowest first: a folder that moved takes its files along
	const gone_folders = [...base]
		.filter(([relative, entry]) => entry.kind === 'folder' && is_gone(relative))
		.map(([relative]) => relative)
		.sort((a, b) => depth(a) - depth(b))
	for (const from of gone_folders) {
		const entry = base.get(from)
		if (!entry || !is_gone(from) || !unchanged_cloud(entry)) continue
		const inside = [...base].filter(([relative]) => relative.startsWith(`${from}/`))
		const candidates = [...local.values()].filter(folder =>
			folder.kind === 'folder'
			&& !base.has(folder.relative)
			&& inside.every(([relative, known]) => {
				const moved = local.get(folder.relative + relative.slice(from.length))
				return moved?.kind === known.kind && (known.kind === 'folder' || !is_local_change(moved, known))
			}))
		// without files to recognize it by (an empty folder, or only empty
		// subfolders), a rename is the one new folder next to the old one.
		// A wrong guess costs little: an empty cloud folder gets renamed
		// instead of trashed
		const has_files = inside.some(([, known]) => known.kind === 'file')
		const matches = has_files
			? candidates
			: candidates.filter(folder => parent_relative(folder.relative) === parent_relative(from))
		if (matches.length !== 1) continue
		const to = matches[0]!.relative
		moves.push({ kind: 'move', from, relative: to, cloud_id: entry.cloud_id })
		moved_to.add(to)
		rekey(base, from, to)
	}

	const signature = (size: number, mtime_ms: number) => `${size}:${mtime_ms}`
	const gone_files = new Map<string, string[]>()
	for (const [relative, entry] of base) {
		if (entry.kind !== 'file' || !is_gone(relative) || !unchanged_cloud(entry)) continue
		const key = signature(entry.size, entry.mtime_ms)
		gone_files.set(key, [...(gone_files.get(key) ?? []), relative])
	}
	const new_files = new Map<string, string[]>()
	for (const entry of local.values()) {
		if (entry.kind !== 'file' || base.has(entry.relative)) continue
		const key = signature(entry.size, entry.mtime_ms)
		new_files.set(key, [...(new_files.get(key) ?? []), entry.relative])
	}
	for (const [key, [from, ...more_gone]] of gone_files) {
		const [to, ...more_new] = new_files.get(key) ?? []
		// only an unambiguous pair is a move; anything else is a delete and a new file
		if (!from || !to || more_gone.length > 0 || more_new.length > 0) continue
		const entry = base.get(from)!
		moves.push({ kind: 'move', from, relative: to, cloud_id: entry.cloud_id })
		moved_to.add(to)
		rekey(base, from, to)
	}

	// ---- where an entry lands in the cloud ---------------------------------
	const moved_below = (relative: string) => [...moved_to].some(to => is_within(relative, to))
	const cloud_paths = new Map<string, string | null>([['', '/']])
	const cloud_path_of = (relative: string): string | null => {
		const known = cloud_paths.get(relative)
		if (known !== undefined) return known
		const entry = base.get(relative)
		const cloud = entry ? cloud_by_id.get(entry.cloud_id) : undefined
		let path: string | null
		if (cloud && !moved_below(relative)) {
			path = cloud.path
		} else {
			const parent = cloud_path_of(parent_relative(relative))
			path = parent === null ? null : join_cloud(parent, base_name(relative))
		}
		cloud_paths.set(relative, path)
		return path
	}

	// ---- per entry ---------------------------------------------------------
	const structure: SyncAction[] = [...moves.filter(move => base.get(move.relative)?.kind === 'folder')]
	const content: SyncAction[] = [...moves.filter(move => base.get(move.relative)?.kind === 'file')]
	const removals: SyncAction[] = []
	// a file that became a folder (or back) leaves before its name is reused
	const replaced: SyncAction[] = []
	const clashed = new Set<string>()

	const by_depth = [...local.values()].sort((a, b) => depth(a.relative) - depth(b.relative))
	for (const entry of by_depth) {
		const { relative } = entry
		if (moved_to.has(relative)) continue
		const parent = parent_relative(relative)
		if (parent !== '' && clashed.has(parent)) {
			clashed.add(relative)
			skips.push({ kind: 'skip', relative, reason: 'parent_skipped' })
			continue
		}

		let known = base.get(relative)
		if (known && known.kind !== entry.kind) {
			// a file became a folder or back: the old one goes, the new one comes
			const cloud = unchanged_cloud(known)
			replaced.push(cloud ? { kind: 'delete', relative, cloud_id: known.cloud_id } : { kind: 'forget', relative })
			known = undefined
		}
		const cloud = known ? cloud_by_id.get(known.cloud_id) : undefined

		if (known && cloud) {
			if (entry.kind === 'folder' || !is_local_change(entry, known)) continue
			content.push(is_cloud_change(cloud, known)
				? { kind: 'conflict', relative }
				: { kind: 'update', relative, cloud_id: cloud.id })
			continue
		}
		// known but gone from the cloud: a folder comes back, an unchanged
		// file stays deleted there, an edited one comes back
		if (known && entry.kind === 'file' && !is_local_change(entry, known)) continue

		const path = cloud_path_of(relative)
		const there = path === null ? undefined : cloud_by_path.get(path)
		if (entry.kind === 'folder') {
			if (!there) structure.push({ kind: 'create_folder', relative })
			else if (there.kind === 'folder') structure.push({ kind: 'adopt', relative, cloud_id: there.id })
			else {
				clashed.add(relative)
				skips.push({ kind: 'skip', relative, reason: 'kind_clash' })
			}
			continue
		}
		if (!there) {
			content.push({ kind: 'upload', relative })
		} else if (there.kind === 'folder' || known) {
			content.push({ kind: 'conflict', relative })
		} else if (there.size === entry.size) {
			content.push({ kind: 'adopt', relative, cloud_id: there.id })
		} else {
			const untouched = options.adopt_before !== undefined
				&& there.modified_at !== null
				&& Date.parse(there.modified_at) <= options.adopt_before
			content.push(untouched
				? { kind: 'update', relative, cloud_id: there.id }
				: { kind: 'conflict', relative })
		}
	}

	// ---- deleted here ------------------------------------------------------
	const linked = new Map<string, string>()
	for (const [relative, entry] of base) linked.set(entry.cloud_id, relative)
	const deletable_folder = (folder: CloudEntry): boolean =>
		cloud_entries.every((cloud) => {
			if (!cloud.path.startsWith(`${folder.path}/`)) return true
			const relative = linked.get(cloud.id)
			if (relative === undefined || !is_gone(relative)) return false
			const entry = base.get(relative)!
			return !is_cloud_change(cloud, entry)
		})

	const deleted_folders: string[] = []
	let deletes = 0
	const gone = [...base].filter(([relative]) => is_gone(relative)).sort(([a], [b]) => depth(a) - depth(b))
	for (const [relative, entry] of gone) {
		if (deleted_folders.some(folder => is_within(relative, folder))) {
			if (entry.kind === 'file') deletes += 1
			continue
		}
		const cloud = unchanged_cloud(entry)
		const removable = cloud && (entry.kind === 'file' || deletable_folder(cloud))
		if (!removable) {
			removals.push({ kind: 'forget', relative })
			continue
		}
		removals.push({ kind: 'delete', relative, cloud_id: entry.cloud_id })
		if (entry.kind === 'folder') deleted_folders.push(relative)
		else deletes += 1
	}

	structure.sort((a, b) => depth(a.relative) - depth(b.relative))
	return { actions: [...skips, ...replaced, ...structure, ...content, ...removals], deletes, base_files }
}

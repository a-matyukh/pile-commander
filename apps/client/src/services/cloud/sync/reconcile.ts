import { base_name, cloud_relative, depth, is_local_name, is_within, parent_relative } from './paths'
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

function is_content_change(cloud: CloudEntry, base: BaseEntry): boolean {
	return base.kind === 'file' && cloud.modified_at !== base.cloud_modified_at
}

/** Moves the keys of `from` (and everything below it) under `to`. */
function rekey<T>(map: Map<string, T>, from: string, to: string, update: (value: T, key: string) => T = value => value): void {
	for (const [key, value] of [...map]) {
		if (!is_within(key, from)) continue
		const moved = to + key.slice(from.length)
		map.delete(key)
		map.set(moved, update(value, moved))
	}
}

const by_depth = (a: string, b: string) => depth(a) - depth(b)

/**
 * Plans one two-way pass from the base, the folder on disk and the cloud
 * listing. Pure: no I/O, the executor (syncPass.ts) carries the actions out.
 *
 * 1. Moves here → cloud: a file with the same size and mtime under a new
 *    path, or a folder whose files all moved along, while its cloud row stayed
 *    put and unchanged: the cloud row follows, keeping its id.
 * 2. Moves in the cloud → here: a linked row under another path while the
 *    entry here stayed put: the file or folder here follows.
 * 3. Per entry, with the base as the common ancestor: a change on one side
 *    goes to the other; a file changed on both sides keeps the cloud version
 *    under its name and the local one as a conflicted copy; a deletion goes
 *    through when the other side did not change the entry, and is undone
 *    (the entry comes back) when it did. A folder is removed on either side
 *    only when nothing in it would be lost.
 */
export function reconcile(
	base_record: Readonly<Record<string, BaseEntry>>,
	local_entries: readonly LocalEntry[],
	cloud_entries: readonly CloudEntry[],
	options: ReconcileOptions,
): SyncPlan {
	const base = new Map(Object.entries(base_record))
	const base_files = [...base.values()].filter(entry => entry.kind === 'file').length

	const { local: scanned, skipped, skips } = partition_local(local_entries, options)
	// the folder as it will be once this pass's moves here are done
	const local = new Map(scanned)
	const is_blocked = (relative: string): boolean => {
		for (let at = relative; at !== ''; at = parent_relative(at)) {
			if (skipped.has(at) || options.exclude.has(at)) return true
		}
		return false
	}
	const is_gone = (relative: string) => !local.has(relative) && !is_blocked(relative)

	// every row by id (existence); the rows this device can hold, by path
	const cloud_by_id = new Map(cloud_entries.map(row => [row.id, row]))
	const cloud_at = new Map<string, CloudEntry>()
	const unwritable = new Set<string>()
	for (const row of [...cloud_entries].sort((a, b) => by_depth(cloud_relative(a.path), cloud_relative(b.path)))) {
		if (row.path === '/') continue
		const relative = cloud_relative(row.path)
		const parent = parent_relative(relative)
		// a name this device cannot write, and everything below it, stays in the cloud
		if (!is_local_name(row.name) || (parent !== '' && unwritable.has(parent))) {
			unwritable.add(relative)
			continue
		}
		if (!is_blocked(relative)) cloud_at.set(relative, row)
	}

	const occupied = new Set<string>()
	const note_occupied = (relative: string) => {
		if (occupied.has(relative)) return
		occupied.add(relative)
		skips.push({ kind: 'skip', relative, reason: 'occupied' })
	}

	// ---- 1. moves here → cloud ---------------------------------------------
	const moves: Extract<SyncAction, { kind: 'move' }>[] = []
	const stays_in_cloud = (entry: BaseEntry, key: string): boolean => {
		const row = cloud_by_id.get(entry.cloud_id)
		return !!row && !is_content_change(row, entry) && cloud_relative(row.path) === key
	}

	// folders first, shallowest first: a folder that moved takes its files along
	const gone_folders = [...base]
		.filter(([relative, entry]) => entry.kind === 'folder' && is_gone(relative))
		.map(([relative]) => relative)
		.sort(by_depth)
	for (const from of gone_folders) {
		const entry = base.get(from)
		if (!entry || !is_gone(from) || !stays_in_cloud(entry, from)) continue
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
		rekey(base, from, to)
	}

	const signature = (size: number, mtime_ms: number) => `${size}:${mtime_ms}`
	const gone_files = new Map<string, string[]>()
	for (const [relative, entry] of base) {
		if (entry.kind !== 'file' || !is_gone(relative) || !stays_in_cloud(entry, relative)) continue
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
		rekey(base, from, to)
	}

	// where a key of the (rekeyed) base sits in the cloud until the moves above are done
	const cloud_key = (relative: string): string => {
		let key = relative
		for (const move of [...moves].reverse()) {
			if (is_within(key, move.relative)) key = move.from + key.slice(move.relative.length)
		}
		return key
	}

	// ---- 2. moves in the cloud → here --------------------------------------
	const local_moves: Extract<SyncAction, { kind: 'local_move' }>[] = []
	for (let round = 0; round < 8; round++) {
		let moved = false
		for (const key of [...base.keys()].sort(by_depth)) {
			const entry = base.get(key)
			const row = entry ? cloud_by_id.get(entry.cloud_id) : undefined
			if (!entry || !row || !local.has(key)) continue
			const target = cloud_relative(row.path)
			if (target === cloud_key(key) || !cloud_at.has(target)) continue
			// something else here already holds the target: leave both this pass
			if (local.has(target) || base.has(target)) {
				note_occupied(key)
				continue
			}
			local_moves.push({ kind: 'local_move', from: key, relative: target, cloud_id: entry.cloud_id })
			rekey(base, key, target)
			rekey(local, key, target, (value, moved_to) => ({ ...value, relative: moved_to, name: base_name(moved_to) }))
			moved = true
		}
		if (!moved) break
	}

	// ---- 3. per entry --------------------------------------------------------
	const linked = new Map([...base].map(([relative, entry]) => [entry.cloud_id, relative]))
	const deletable_in_cloud = (folder: CloudEntry): boolean =>
		cloud_entries.every((row) => {
			if (!row.path.startsWith(`${folder.path}/`)) return true
			const relative = linked.get(row.id)
			if (relative === undefined || !is_gone(relative)) return false
			return !is_content_change(row, base.get(relative)!)
		})
	const removable_here = (folder: string): boolean =>
		[...local.values()].every((entry) => {
			if (!entry.relative.startsWith(`${folder}/`)) return true
			const known = base.get(entry.relative)
			if (!known || known.kind !== entry.kind) return false
			if (entry.kind === 'file' && is_local_change(entry, known)) return false
			return !cloud_by_id.has(known.cloud_id)
		})
	const untouched_since_link = (row: CloudEntry) =>
		options.adopt_before !== undefined
		&& row.modified_at !== null
		&& Date.parse(row.modified_at) <= options.adopt_before

	const is_folder_move = (move: { relative: string }) => base.get(move.relative)?.kind === 'folder'
	const structure: SyncAction[] = [...moves.filter(is_folder_move), ...local_moves.filter(is_folder_move)]
	const content: SyncAction[] = [
		...moves.filter(move => !is_folder_move(move)),
		...local_moves.filter(move => !is_folder_move(move)),
	]
	// a file that became a folder (or back) leaves before its name is reused
	const replaced: SyncAction[] = []
	const removals: SyncAction[] = []
	const clashed = new Set<string>()
	const trashed_in_cloud: string[] = []
	const trashed_here: string[] = []
	let deletes = 0
	let local_deletes = 0

	const keys = [...new Set([...base.keys(), ...local.keys(), ...cloud_at.keys()])].sort(by_depth)
	for (const relative of keys) {
		if (is_blocked(relative)) continue
		let known = base.get(relative)
		if (trashed_in_cloud.some(folder => is_within(relative, folder))) {
			if (known?.kind === 'file') deletes += 1
			continue
		}
		if (trashed_here.some(folder => is_within(relative, folder))) {
			if (known?.kind === 'file') local_deletes += 1
			continue
		}
		const parent = parent_relative(relative)
		if (parent !== '' && clashed.has(parent)) {
			clashed.add(relative)
			skips.push({ kind: 'skip', relative, reason: 'parent_skipped' })
			continue
		}

		const here = local.get(relative)
		const there = cloud_at.get(relative)
		let row = known ? cloud_by_id.get(known.cloud_id) : undefined

		if (known && here && known.kind !== here.kind) {
			// a file became a folder here, or back: the old one goes, the new one comes
			replaced.push(stays_in_cloud(known, cloud_key(relative))
				? { kind: 'delete', relative, cloud_id: known.cloud_id }
				: { kind: 'forget', relative })
			known = undefined
			row = undefined
		}

		if (known) {
			// linked to a row that moved elsewhere in the cloud while its move here is held up
			if (row && cloud_relative(row.path) !== cloud_key(relative)) continue
			if (here && row) {
				if (known.kind === 'folder') continue
				const changed_here = is_local_change(here, known)
				const changed_there = is_content_change(row, known)
				if (changed_here && changed_there) content.push({ kind: 'local_conflict', relative, cloud_id: row.id })
				else if (changed_here) content.push({ kind: 'update', relative, cloud_id: row.id })
				else if (changed_there) content.push({ kind: 'download', relative, cloud_id: row.id })
				continue
			}
			if (here) {
				// deleted in the cloud
				if (known.kind === 'file') {
					if (is_local_change(here, known)) {
						content.push(there && !linked.has(there.id)
							? { kind: 'local_conflict', relative, cloud_id: there.id }
							: { kind: 'upload', relative })
					} else if (there && !linked.has(there.id)) {
						// another file took the name in the cloud
						content.push({ kind: 'download', relative, cloud_id: there.id })
					} else {
						removals.push({ kind: 'local_trash', relative })
						local_deletes += 1
					}
				} else if (there?.kind === 'folder' && !linked.has(there.id)) {
					structure.push({ kind: 'adopt', relative, cloud_id: there.id })
				} else if (removable_here(relative)) {
					removals.push({ kind: 'local_trash', relative })
					trashed_here.push(relative)
				} else {
					structure.push({ kind: 'create_folder', relative })
				}
				continue
			}
			if (row) {
				// deleted here
				if (!is_gone(relative)) continue
				if (known.kind === 'file') {
					if (is_content_change(row, known)) {
						content.push({ kind: 'download', relative, cloud_id: row.id })
					} else {
						removals.push({ kind: 'delete', relative, cloud_id: row.id })
						deletes += 1
					}
				} else if (deletable_in_cloud(row)) {
					removals.push({ kind: 'delete', relative, cloud_id: row.id })
					trashed_in_cloud.push(relative)
				} else {
					structure.push({ kind: 'download_folder', relative, cloud_id: row.id })
				}
				continue
			}
			removals.push({ kind: 'forget', relative })
			continue
		}

		// not linked yet
		if (here && there) {
			if (linked.has(there.id)) {
				note_occupied(relative)
				continue
			}
			if (here.kind !== there.kind) {
				clashed.add(relative)
				skips.push({ kind: 'skip', relative, reason: 'kind_clash' })
			} else if (here.kind === 'folder') {
				structure.push({ kind: 'adopt', relative, cloud_id: there.id })
			} else if (here.size === there.size) {
				content.push({ kind: 'adopt', relative, cloud_id: there.id })
			} else if (untouched_since_link(there)) {
				content.push({ kind: 'update', relative, cloud_id: there.id })
			} else {
				content.push({ kind: 'local_conflict', relative, cloud_id: there.id })
			}
			continue
		}
		if (here) {
			if (here.kind === 'folder') structure.push({ kind: 'create_folder', relative })
			else content.push({ kind: 'upload', relative })
			continue
		}
		if (there && !linked.has(there.id)) {
			if (there.kind === 'folder') structure.push({ kind: 'download_folder', relative, cloud_id: there.id })
			else content.push({ kind: 'download', relative, cloud_id: there.id })
		}
	}

	structure.sort((a, b) => by_depth((a as { relative: string }).relative, (b as { relative: string }).relative))
	return {
		actions: [...skips, ...replaced, ...structure, ...content, ...removals],
		deletes,
		local_deletes,
		base_files,
	}
}

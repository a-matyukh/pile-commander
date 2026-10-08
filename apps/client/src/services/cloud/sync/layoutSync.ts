import type { FolderConnection, FolderStroke } from '@pile-commander/file-manager'
import { derived_uuid, hash_value } from './hash'
import type { ConnectionBase, StrokeBase } from './types'

/**
 * Three-way merges of a folder's layout (LOCAL_SYNC_PHASE2.md, "Раскладка").
 * Pure: the pass (syncPass.ts) reads both sides, calls these and writes the
 * result. A change on one side goes to the other; changed on both, the cloud
 * wins; deleted on one side, it goes on the other — except ink and edges that
 * came down less than RACE_WINDOW_MS ago and vanished here: an open board
 * wrote its old sidecar over them, so they come down again.
 */

export const RACE_WINDOW_MS = 10_000

// ---- xattrs ----------------------------------------------------------------

export type XattrsMerge = {
	/** What both sides hold once the writes are done. */
	merged: Record<string, string>
	local_sets: Record<string, string>
	local_removes: string[]
	cloud_sets: Record<string, string>
	cloud_removes: string[]
}

/**
 * Key by key. With no base (an entry not merged yet: just linked, or a v1
 * link whose last push is unknown) nothing counts as removed: a key on one
 * side goes to the other, and where values differ the local one goes up.
 */
export function merge_xattrs(
	base: Readonly<Record<string, string>> | undefined,
	local: Readonly<Record<string, string>>,
	cloud: Readonly<Record<string, string>>,
): XattrsMerge {
	const result: XattrsMerge = { merged: {}, local_sets: {}, local_removes: [], cloud_sets: {}, cloud_removes: [] }
	for (const name of new Set([...Object.keys(local), ...Object.keys(cloud), ...Object.keys(base ?? {})])) {
		const here = local[name]
		const there = cloud[name]
		let value: string | undefined
		if (!base) value = here ?? there
		else if (here === there) value = here
		else if (here === base[name]) value = there // changed in the cloud
		else if (there === base[name]) value = here // changed here
		else value = there // changed on both sides: the cloud wins
		if (value !== undefined) result.merged[name] = value
		if (value !== here) {
			if (value === undefined) result.local_removes.push(name)
			else result.local_sets[name] = value
		}
		if (value !== there) {
			if (value === undefined) result.cloud_removes.push(name)
			else result.cloud_sets[name] = value
		}
	}
	return result
}

// ---- ink -------------------------------------------------------------------

export function stroke_hash(stroke: FolderStroke): string {
	return hash_value({ ...stroke, id: undefined })
}

export type StrokesMerge = {
	/** Under their local ids. */
	local_upserts: FolderStroke[]
	local_deletes: string[]
	/** Under their cloud ids. */
	cloud_upserts: FolderStroke[]
	cloud_deletes: string[]
	/** The base once the writes are done, by cloud id. */
	next: Record<string, StrokeBase>
	/** Cloud ids whose entry in `next` depends on a local write landing. */
	written_here: Set<string>
}

/**
 * By cloud id. Ink drawn here goes up as `derived_uuid(workspace, local id)`;
 * ink that came down keeps its cloud id here too, so it is never hashed
 * again (that would duplicate it every cycle).
 */
export async function merge_strokes(
	workspace_id: string,
	base: Readonly<Record<string, StrokeBase>>,
	local: readonly FolderStroke[],
	cloud: readonly FolderStroke[],
	now: number,
): Promise<StrokesMerge> {
	const cloud_id_of = new Map(Object.entries(base).map(([cloud_id, known]) => [known.local_id, cloud_id]))
	const here = new Map<string, FolderStroke>()
	for (const stroke of local) {
		here.set(cloud_id_of.get(stroke.id) ?? await derived_uuid(workspace_id, stroke.id), stroke)
	}
	const there = new Map(cloud.map(stroke => [stroke.id, stroke]))
	const result: StrokesMerge = {
		local_upserts: [],
		local_deletes: [],
		cloud_upserts: [],
		cloud_deletes: [],
		next: {},
		written_here: new Set(),
	}
	const recent = (known: StrokeBase | undefined) =>
		known?.downloaded_at !== undefined && now - known.downloaded_at < RACE_WINDOW_MS
	const keep_window = (known: StrokeBase | undefined) => (recent(known) ? { downloaded_at: known!.downloaded_at } : {})
	const come_down = (cloud_id: string, stroke: FolderStroke, local_id: string, downloaded_at: number) => {
		result.local_upserts.push({ ...stroke, id: local_id })
		result.next[cloud_id] = { local_id, hash: stroke_hash(stroke), downloaded_at }
		result.written_here.add(cloud_id)
	}

	for (const cloud_id of new Set([...Object.keys(base), ...here.keys(), ...there.keys()])) {
		const known = base[cloud_id]
		const mine = here.get(cloud_id)
		const theirs = there.get(cloud_id)
		if (mine && theirs) {
			const mine_hash = stroke_hash(mine)
			const theirs_hash = stroke_hash(theirs)
			if (mine_hash === theirs_hash) {
				result.next[cloud_id] = { local_id: mine.id, hash: mine_hash, ...keep_window(known) }
			} else if (known && theirs_hash === known.hash) {
				// changed here
				result.cloud_upserts.push({ ...mine, id: cloud_id })
				result.next[cloud_id] = { local_id: mine.id, hash: mine_hash }
			} else {
				// changed in the cloud, or on both sides: the cloud wins
				come_down(cloud_id, theirs, mine.id, known?.downloaded_at ?? now)
			}
		} else if (mine) {
			// deleted in the cloud: it goes here too; new here: it goes up
			if (known) result.local_deletes.push(mine.id)
			else {
				result.cloud_upserts.push({ ...mine, id: cloud_id })
				result.next[cloud_id] = { local_id: mine.id, hash: stroke_hash(mine) }
			}
		} else if (theirs) {
			if (!known) {
				// new in the cloud: it comes down under its cloud id
				come_down(cloud_id, theirs, cloud_id, now)
			} else if (recent(known) || stroke_hash(theirs) !== known.hash) {
				// overwritten here by a board right after it came down, or erased
				// here while changed in the cloud: it comes down again
				come_down(cloud_id, theirs, known.local_id, known.downloaded_at ?? now)
			} else {
				result.cloud_deletes.push(cloud_id)
			}
		}
		// gone on both sides: forgotten
	}
	return result
}

// ---- edges -----------------------------------------------------------------

/** The same on both sides: root-relative ends and handles. */
export function connection_key(connection: FolderConnection): string {
	return `${connection.from}|${connection.from_handle ?? 'default'}|${connection.to}|${connection.to_handle ?? 'default'}`
}

export function connection_hash(connection: FolderConnection): string {
	return hash_value({
		marker_start: connection.marker_start,
		marker_end: connection.marker_end,
		is_animated: connection.is_animated,
		label: connection.label || undefined,
	})
}

export type ConnectionsMerge = {
	/** Root-relative ends; the caller gives them the ids and paths of each side. */
	local_upserts: FolderConnection[]
	/** Ids here of the edges to remove. */
	local_deletes: string[]
	cloud_upserts: FolderConnection[]
	/** Cloud ids of the edges to remove. */
	cloud_deletes: string[]
	next: Record<string, ConnectionBase>
	written_here: Set<string>
}

/** By their ends (`connection_key`); both lists carry root-relative ends and each side's own ids. */
export function merge_connections(
	base: Readonly<Record<string, ConnectionBase>>,
	local: readonly FolderConnection[],
	cloud: readonly FolderConnection[],
	now: number,
): ConnectionsMerge {
	const here = new Map(local.map(connection => [connection_key(connection), connection]))
	const there = new Map(cloud.map(connection => [connection_key(connection), connection]))
	const result: ConnectionsMerge = {
		local_upserts: [],
		local_deletes: [],
		cloud_upserts: [],
		cloud_deletes: [],
		next: {},
		written_here: new Set(),
	}
	const recent = (known: ConnectionBase | undefined) =>
		known?.downloaded_at !== undefined && now - known.downloaded_at < RACE_WINDOW_MS
	const come_down = (key: string, connection: FolderConnection, downloaded_at: number) => {
		result.local_upserts.push(connection)
		result.next[key] = { hash: connection_hash(connection), downloaded_at }
		result.written_here.add(key)
	}

	for (const key of new Set([...Object.keys(base), ...here.keys(), ...there.keys()])) {
		const known = base[key]
		const mine = here.get(key)
		const theirs = there.get(key)
		if (mine && theirs) {
			const mine_hash = connection_hash(mine)
			const theirs_hash = connection_hash(theirs)
			if (mine_hash === theirs_hash) {
				result.next[key] = { hash: mine_hash, ...(recent(known) ? { downloaded_at: known!.downloaded_at } : {}) }
			} else if (known && theirs_hash === known.hash) {
				result.cloud_upserts.push(mine)
				result.next[key] = { hash: mine_hash }
			} else {
				come_down(key, theirs, known?.downloaded_at ?? now)
			}
		} else if (mine) {
			if (known) result.local_deletes.push(mine.id)
			else {
				result.cloud_upserts.push(mine)
				result.next[key] = { hash: connection_hash(mine) }
			}
		} else if (theirs) {
			if (!known) come_down(key, theirs, now)
			else if (recent(known) || connection_hash(theirs) !== known.hash) come_down(key, theirs, known.downloaded_at ?? now)
			else result.cloud_deletes.push(theirs.id)
		}
	}
	return result
}

// ---- lifting a v1 state ------------------------------------------------------

/**
 * A v1 folder base held one hash of the ink last pushed. When the ink here
 * still matches it, the cloud holds that ink under derived ids: that is the
 * base. Otherwise nothing is known, and the merge starts from empty.
 */
export async function lift_v1_strokes(
	workspace_id: string,
	legacy_hash: string | undefined,
	current_hash: string,
	local: readonly FolderStroke[],
): Promise<Record<string, StrokeBase>> {
	if (legacy_hash === undefined || legacy_hash !== current_hash) return {}
	const base: Record<string, StrokeBase> = {}
	for (const stroke of local) {
		base[await derived_uuid(workspace_id, stroke.id)] = { local_id: stroke.id, hash: stroke_hash(stroke) }
	}
	return base
}

export function lift_v1_connections(
	legacy_hash: string | undefined,
	current_hash: string,
	local: readonly FolderConnection[],
): Record<string, ConnectionBase> {
	if (legacy_hash === undefined || legacy_hash !== current_hash) return {}
	return Object.fromEntries(local.map(connection => [connection_key(connection), { hash: connection_hash(connection) }]))
}

/** v1 xattrs: the local values when they still match the hash last pushed. */
export function lift_v1_xattrs(
	legacy_hash: string | undefined,
	local: Readonly<Record<string, string>>,
): Record<string, string> | undefined {
	return legacy_hash !== undefined && legacy_hash === hash_value(local) ? { ...local } : undefined
}

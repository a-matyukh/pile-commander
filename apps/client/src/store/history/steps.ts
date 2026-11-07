import type { FileManager, FolderConnection, FolderStroke } from '@pile-commander/file-manager'
import type { Connection, StrokeNode } from '@/domain/Widget'
import { connection_to_folder_connection } from '@/services/canvas/connections'
import { node_to_folder_stroke } from '@/services/canvas/strokes'
import { sort_entries_by_order_then_name } from '@/services/workspace/folderContainer'
import { path_separator } from '@/services/workspace/paths'
import { parse_xattr_value } from '@/services/workspace/xattrs'
import type { HistoryStep } from './types'

/**
 * What the history needs of a store: its file manager, to read what is there
 * now, and writes that record nothing. Each write resolves true once it is saved
 */
export type HistoryTarget = {
	file_manager: FileManager
	history_write_attr(id: string, name: string, value: string | null, look: boolean): Promise<boolean>
	history_write_content(id: string, content: string, format: 'note' | 'svg'): Promise<boolean>
	upsert_connections(folder_id: string, connections: Connection[]): Promise<boolean>
	delete_connections(folder_id: string, connection_ids: string[]): Promise<boolean>
	upsert_strokes(folder_id: string, strokes: StrokeNode[]): Promise<boolean>
	delete_strokes(folder_id: string, stroke_ids: string[]): Promise<boolean>
	reorder_children(folder_id: string, ordered_ids: string[]): Promise<boolean>
}

/** Which state of a step: as it was (`before`) or as the action left it (`after`) */
export type Side = 'before' | 'after'

/**
 * A value as one string whatever its key order. `round`: numbers to 0.01, the
 * precision ink and edges are stored at
 */
function canonical(value: unknown, round = false): string {
	if (Array.isArray(value)) return `[${value.map(item => canonical(item, round)).join(',')}]`
	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
		return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item, round)}`).join(',')}}`
	}
	if (round && typeof value === 'number') return String(Math.round(value * 100) / 100)
	return JSON.stringify(value) ?? 'undefined'
}

/** Two stored attribute values mean the same: equal, or the same JSON in another key order */
export function same_attr(a: string | null, b: string | null): boolean {
	if (a === b) return true
	if (a === null || b === null) return false
	return canonical(parse_xattr_value(a)) === canonical(parse_xattr_value(b))
}

/**
 * What is there now, read from the backend and not from the store's cache: the
 * cache shows a shape's preview SVG instead of its file, drops a note after its
 * own save, and keeps its own value over someone else's for two seconds after
 * a write. One read per thing per undo
 */
export type FreshReads = {
	attr(id: string, name: string): Promise<string | null>
	text(id: string): Promise<string>
	connections(folder_id: string): Promise<Map<string, FolderConnection>>
	strokes(folder_id: string): Promise<Map<string, FolderStroke>>
	order(folder_id: string): Promise<string[]>
}

export function fresh_reads(fm: FileManager): FreshReads {
	const memo = new Map<string, Promise<unknown>>()
	const once = <T>(key: string, read: () => Promise<T>): Promise<T> => {
		let pending = memo.get(key) as Promise<T> | undefined
		if (!pending) {
			pending = read()
			memo.set(key, pending)
		}
		return pending
	}
	return {
		attr: (id, name) => once(`attr\0${id}\0${name}`, () => fm.get_xattr(id, name)),
		text: id => once(`text\0${id}`, () => fm.read_text_file(id)),
		connections: folder_id => once(`edges\0${folder_id}`, async () =>
			new Map((await fm.connections.list_connections(folder_id)).map(edge => [edge.id, edge]))),
		strokes: folder_id => once(`strokes\0${folder_id}`, async () =>
			new Map((await fm.strokes.list_strokes(folder_id)).map(stroke => [stroke.id, stroke]))),
		order: folder_id => once(`order\0${folder_id}`, async () => {
			const folder = await fm.folder_with_children_xattrs(folder_id)
			return sort_entries_by_order_then_name(folder.children ?? []).map(child => child.id)
		}),
	}
}

/** The items of one side of an edges or strokes step, by id, in the stored form */
function items_by_id<T extends { id: string }, S>(items: T[], to_stored: (item: T) => S): Map<string, S> {
	return new Map(items.map(item => [item.id, to_stored(item)]))
}

function same_items<S>(ids: string[], current: Map<string, S>, expected: Map<string, S>): boolean {
	for (const id of ids) {
		const have = current.get(id)
		const want = expected.get(id)
		if (have === undefined || want === undefined) {
			if (have !== want) return false
			continue
		}
		if (canonical(have, true) !== canonical(want, true)) return false
	}
	return true
}

/** The children `expected` names are all there, in that order; others may sit between them */
function same_order(current: string[], expected: string[]): boolean {
	const wanted = new Set(expected)
	const seen = current.filter(id => wanted.has(id))
	return seen.length === expected.length && seen.every((id, index) => id === expected[index])
}

/** What is there now matches the step's `side` */
export async function step_matches(step: HistoryStep, side: Side, reads: FreshReads): Promise<boolean> {
	switch (step.kind) {
		case 'attr':
			return same_attr(await reads.attr(step.id, step.name), step[side])
		case 'content':
			return (await reads.text(step.id)) === step[side]
		case 'edges':
			return same_items(step.ids, await reads.connections(step.folder_id), items_by_id(step[side], connection_to_folder_connection))
		case 'strokes':
			return same_items(step.ids, await reads.strokes(step.folder_id), items_by_id(step[side], node_to_folder_stroke))
		case 'order':
			return same_order(await reads.order(step.folder_id), step[side])
	}
}

/** Bringing a list of edges or strokes to `side`: what to write and what to delete */
function item_changes<T extends { id: string }>(before: T[], after: T[], side: Side) {
	const wanted = side === 'before' ? before : after
	const other = side === 'before' ? after : before
	const keep = new Set(wanted.map(item => item.id))
	return { upsert: wanted, remove: other.filter(item => !keep.has(item.id)).map(item => item.id) }
}

/** Writes the step's `side`. True once it is saved */
export async function apply_step(target: HistoryTarget, step: HistoryStep, side: Side): Promise<boolean> {
	switch (step.kind) {
		case 'attr':
			return target.history_write_attr(step.id, step.name, step[side], step.look)
		case 'content':
			return target.history_write_content(step.id, step[side], step.format)
		case 'edges': {
			const { upsert, remove } = item_changes(step.before, step.after, side)
			const written = upsert.length === 0 || await target.upsert_connections(step.folder_id, upsert)
			const removed = remove.length === 0 || await target.delete_connections(step.folder_id, remove)
			return written && removed
		}
		case 'strokes': {
			const { upsert, remove } = item_changes(step.before, step.after, side)
			const written = upsert.length === 0 || await target.upsert_strokes(step.folder_id, upsert)
			const removed = remove.length === 0 || await target.delete_strokes(step.folder_id, remove)
			return written && removed
		}
		case 'order':
			return target.reorder_children(step.folder_id, step[side])
	}
}

/** Merges the items of a later edges or strokes step into an earlier one of the same folder */
function merge_items<T extends { id: string }>(
	into: { ids: string[]; before: T[]; after: T[] },
	next: { ids: string[]; before: T[]; after: T[] },
) {
	const tracked = new Set(into.ids)
	for (const id of next.ids) {
		if (tracked.has(id)) continue
		tracked.add(id)
		into.ids.push(id)
		const was = next.before.find(item => item.id === id)
		if (was) into.before.push(was)
	}
	const touched = new Set(next.ids)
	into.after = [...into.after.filter(item => !touched.has(item.id)), ...next.after]
}

/**
 * Adds a step to a record's steps. A later write of the same thing folds into
 * the earlier step, keeping its `before`: a record holds one step per thing,
 * so each can be checked against what is there now on its own
 */
export function merge_step(steps: HistoryStep[], next: HistoryStep): void {
	for (const step of steps) {
		if (step.kind === 'attr' && next.kind === 'attr' && step.id === next.id && step.name === next.name) {
			step.after = next.after
			step.look = next.look
			return
		}
		if (step.kind === 'content' && next.kind === 'content' && step.id === next.id) {
			step.after = next.after
			return
		}
		if (step.kind === 'edges' && next.kind === 'edges' && step.folder_id === next.folder_id) {
			merge_items(step, next)
			return
		}
		if (step.kind === 'strokes' && next.kind === 'strokes' && step.folder_id === next.folder_id) {
			merge_items(step, next)
			return
		}
		if (step.kind === 'order' && next.kind === 'order' && step.folder_id === next.folder_id) {
			step.after = next.after
			return
		}
	}
	steps.push(copy_step(next))
}

function copy_step(step: HistoryStep): HistoryStep {
	switch (step.kind) {
		case 'edges':
		case 'strokes':
			return { ...step, ids: [...step.ids], before: [...step.before], after: [...step.after] } as HistoryStep
		case 'order':
			return { ...step, before: [...step.before], after: [...step.after] }
		default:
			return { ...step }
	}
}

/** Drops what an action changed back to how it was: a step whose two sides are the same */
export function prune_steps(steps: HistoryStep[]): HistoryStep[] {
	const kept: HistoryStep[] = []
	for (const step of steps) {
		if (step.kind === 'attr' && same_attr(step.before, step.after)) continue
		if (step.kind === 'content' && step.before === step.after) continue
		if (step.kind === 'order' && step.before.length === step.after.length && step.before.every((id, i) => id === step.after[i])) continue
		if (step.kind === 'edges' || step.kind === 'strokes') {
			const to_stored = (item: { id: string }): [string, string] => [item.id, canonical(item, true)]
			const before = new Map<string, string>(step.before.map(to_stored))
			const after = new Map<string, string>(step.after.map(to_stored))
			const ids = step.ids.filter(id => before.get(id) !== after.get(id))
			if (ids.length === 0) continue
			if (ids.length !== step.ids.length) {
				const keep = new Set(ids)
				kept.push({
					...step,
					ids,
					before: step.before.filter(item => keep.has(item.id)),
					after: step.after.filter(item => keep.has(item.id)),
				} as HistoryStep)
				continue
			}
		}
		kept.push(step)
	}
	return kept
}

const PATH = 'path\0'

/**
 * What a step is about. Two steps that share a key depend on each other; a
 * path also covers what is inside it
 */
export function step_keys(step: HistoryStep): string[] {
	switch (step.kind) {
		case 'attr':
		case 'content':
			return [`${PATH}${step.id}`]
		case 'edges':
			return step.ids.map(id => `edge\0${step.folder_id}\0${id}`)
		case 'strokes':
			return step.ids.map(id => `stroke\0${step.folder_id}\0${id}`)
		case 'order':
			return [`order\0${step.folder_id}`]
	}
}

function inside(path: string, folder: string): boolean {
	const sep = path_separator(folder)
	return path.startsWith(folder.endsWith(sep) ? folder : folder + sep)
}

/** The step is about something a skipped step is about, or about what is inside a skipped path */
export function depends_on(step: HistoryStep, skipped: Set<string>): boolean {
	for (const key of step_keys(step)) {
		if (skipped.has(key)) return true
		if (!key.startsWith(PATH)) continue
		const path = key.slice(PATH.length)
		for (const other of skipped) {
			if (other.startsWith(PATH) && inside(path, other.slice(PATH.length))) return true
		}
	}
	return false
}

/** How many things a step covers, as a toast counts them */
export function object_count(step: HistoryStep): number {
	return step.kind === 'edges' || step.kind === 'strokes' ? step.ids.length : 1
}

/** The entries an undo brought back, to select them where they are on screen */
export function affected_entries(steps: HistoryStep[]): string[] {
	const ids = new Set<string>()
	for (const step of steps) {
		if (step.kind === 'attr' || step.kind === 'content') ids.add(step.id)
	}
	return [...ids]
}

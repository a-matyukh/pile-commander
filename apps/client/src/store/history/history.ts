import type { FolderRef } from '@/domain/Drive'
import type { AttrStep, HistoryRecord, HistoryStep, HistoryStoreRef, HistoryTx } from './types'
import {
	affected_entries,
	apply_step,
	depends_on,
	fresh_reads,
	merge_step,
	object_count,
	prune_steps,
	rebase_path,
	rebase_step,
	step_keys,
	step_matches,
	type Applied,
	type HistoryTarget,
	type Side,
} from './steps'

/** The store a record's steps are written to, borrowed while an undo runs */
export type BorrowedStore<S extends HistoryTarget> = { store: S; release(): void }

export type HistoryEvent<S extends HistoryTarget = HistoryTarget> =
	| { type: 'recorded'; record: HistoryRecord }
	| {
		type: 'undone' | 'redone'
		record: HistoryRecord
		store: S
		/** Steps written */
		applied: number
		/** Things someone changed since, left as they are */
		skipped: number
		/** Steps whose write failed */
		failed: number
		/** Why some failed, when a step says so ("Исходный файл изменился") */
		messages: string[]
		/** Entries brought back, to select where they are on screen */
		affected: string[]
	}
	/** Undo reached an action that cannot be undone (`label`) */
	| { type: 'blocked'; label: string }
	/** The record's store could not be opened: the record is dropped */
	| { type: 'unreachable'; record: HistoryRecord; direction: 'undo' | 'redo' }

export type HistoryDeps<S extends HistoryTarget> = {
	borrow(ref: HistoryStoreRef): Promise<BorrowedStore<S> | null>
	/**
	 * An undo or redo moved an entry (or found it at another path): bookmarks,
	 * and the place on screen when it was inside, follow it
	 */
	on_moved?(ref: HistoryStoreRef, from: string, to: string): void
	now?: () => number
	/** Records kept for undo */
	limit?: number
	/** Records with the same merge key that follow within this window become one */
	merge_window_ms?: number
}

export type TransactMeta = {
	label: string
	folder: FolderRef
	folder_name: string
	merge_key?: string
	/** Said with "Отменить" once the action is kept */
	notice?: string
}

type OpenTransaction = {
	meta: TransactMeta
	steps: HistoryStep[]
	/** A barrier came while it ran: it records nothing */
	blocked: boolean
	/** Its writes are done; it waits for the ones that started before it */
	done: boolean
	ref: HistoryStoreRef
}

export type History<S extends HistoryTarget = HistoryTarget> = ReturnType<typeof create_history<S>>

/**
 * The window's history of what the person did, for ⌘Z and ⇧⌘Z: one for the
 * whole window, like Finder's. A record is the steps of one action, each a
 * thing as it was and as it became. Undo checks every step against what is
 * there now and leaves alone what someone changed since
 */
export function create_history<S extends HistoryTarget>(deps: HistoryDeps<S>) {
	const now = deps.now ?? (() => Date.now())
	const limit = deps.limit ?? 100
	const merge_window_ms = deps.merge_window_ms ?? 1000

	const undo_stack: HistoryRecord[] = []
	const redo_stack: HistoryRecord[] = []
	/**
	 * Actions still being written, in the order they started. One that ends
	 * first still waits for the ones before it: records go in the order the
	 * person did them (held arrow keys overlap their writes)
	 */
	const open: OpenTransaction[] = []
	const idle_waiters: (() => void)[] = []
	const listeners = new Set<(event: HistoryEvent<S>) => void>()
	/** The action that cannot be undone, met by the next undo */
	let blocked_label: string | null = null
	let replaying = false
	/** Bumped by every new record and barrier: an undo running meanwhile does not keep its redo */
	let commits = 0
	let next_id = 1
	/** The record the last commit made: only it may take a merge */
	let last_committed: number | null = null
	let queue: Promise<void> = Promise.resolve()

	const emit = (event: HistoryEvent<S>) => {
		for (const listener of listeners) {
			try {
				listener(event)
			} catch (error) {
				console.error('[history] listener failed', error)
			}
		}
	}

	const same_store = (folder: FolderRef, ref: HistoryStoreRef) =>
		folder.drive_id === ref.drive_id && folder.root_id === ref.root_id

	/** Keeps the finished actions at the head of the line, in order; wakes undo once all are in */
	const flush = () => {
		while (open.length > 0 && open[0]!.done) {
			const own = open.shift()!
			if (!own.blocked) commit(own.meta, own.steps)
		}
		if (open.length > 0) return
		for (const resolve of idle_waiters.splice(0)) resolve()
	}

	/** Resolves once no action is still being written: an undo waits for the one just done */
	const idle = () => (open.length === 0 ? Promise.resolve() : new Promise<void>(resolve => idle_waiters.push(resolve)))

	function commit(meta: TransactMeta, recorded: HistoryStep[]) {
		const steps = prune_steps(recorded)
		if (steps.length === 0) return
		const at = now()
		const top = undo_stack[undo_stack.length - 1]
		if (
			meta.merge_key
			&& top
			&& top.merge_key === meta.merge_key
			&& last_committed === top.id
			&& redo_stack.length === 0
			&& at - top.updated_at <= merge_window_ms
		) {
			for (const step of steps) merge_step(top.steps, step)
			top.steps = prune_steps(top.steps)
			top.updated_at = at
			if (top.steps.length === 0) undo_stack.pop()
			commits += 1
			return
		}
		const merged: HistoryStep[] = []
		for (const step of steps) merge_step(merged, step)
		const record: HistoryRecord = {
			id: next_id++,
			label: meta.label,
			folder: { ...meta.folder },
			folder_name: meta.folder_name,
			steps: merged,
			merge_key: meta.merge_key,
			notice: meta.notice,
			updated_at: at,
		}
		undo_stack.push(record)
		if (undo_stack.length > limit) undo_stack.splice(0, undo_stack.length - limit)
		redo_stack.length = 0
		blocked_label = null
		last_committed = record.id
		commits += 1
		emit({ type: 'recorded', record })
	}

	/**
	 * Runs one action of the person's. Store methods it calls with `tx` write
	 * their steps into it; the record is kept once the action is done, if it
	 * changed anything. `meta` null (a store outside the Explorer, read-only
	 * access): the action runs and records nothing
	 */
	async function transact<T>(meta: TransactMeta | null, fn: (tx: HistoryTx | undefined) => Promise<T>): Promise<T> {
		if (!meta) return fn(undefined)
		const own: OpenTransaction = {
			meta,
			steps: [],
			blocked: false,
			done: false,
			ref: { drive_id: meta.folder.drive_id, root_id: meta.folder.root_id },
		}
		const tx: HistoryTx = {
			record(step) {
				merge_step(own.steps, step)
			},
		}
		open.push(own)
		try {
			return await fn(tx)
		} finally {
			own.done = true
			flush()
		}
	}

	/** Keeps an action that is already written (the note editor window saves as the person types) */
	function record_applied(meta: TransactMeta, steps: HistoryStep[]) {
		const merged: HistoryStep[] = []
		for (const step of steps) merge_step(merged, step)
		commit(meta, merged)
	}

	/**
	 * An action that cannot be undone: what came before it is out of reach
	 * now, and the next undo says so instead of undoing something older
	 */
	function barrier(label: string) {
		for (const own of open) own.blocked = true
		undo_stack.length = 0
		redo_stack.length = 0
		blocked_label = label
		last_committed = null
		commits += 1
	}

	/**
	 * The app's own write of an attribute, outside any action (a text block
	 * growing with its text): the nearest step about the same attribute takes
	 * the new value as its "after" (or, waiting for redo, as its "before"), so
	 * it does not look like someone else's change. An undo writing its own
	 * steps amends nothing
	 */
	function amend_attr(ref: HistoryStoreRef | null | undefined, id: string, name: string, value: string | null) {
		if (!ref || replaying) return
		const matches = (step: HistoryStep): step is AttrStep => step.kind === 'attr' && step.id === id && step.name === name
		for (let i = open.length - 1; i >= 0; i--) {
			const own = open[i]!
			if (own.ref.drive_id !== ref.drive_id || own.ref.root_id !== ref.root_id) continue
			const step = own.steps.find(matches)
			if (step) {
				step.after = value
				return
			}
		}
		for (let i = undo_stack.length - 1; i >= 0; i--) {
			const record = undo_stack[i]!
			if (!same_store(record.folder, ref)) continue
			const step = record.steps.find(matches)
			if (step) {
				step.after = value
				break
			}
		}
		for (let i = redo_stack.length - 1; i >= 0; i--) {
			const record = redo_stack[i]!
			if (!same_store(record.folder, ref)) continue
			const step = record.steps.find(matches)
			if (step) {
				step.before = value
				break
			}
		}
	}

	/**
	 * An entry ended at another path than its steps say (a clashing name on
	 * the way back, a folder that moved): every step of the store follows it
	 */
	function rebase(ref: HistoryStoreRef, from: string, to: string, current: HistoryRecord) {
		const seen = new Set<HistoryStep>()
		const follow = (step: HistoryStep) => {
			if (seen.has(step)) return
			seen.add(step)
			rebase_step(step, from, to)
		}
		for (const record of [...undo_stack, ...redo_stack, current]) {
			if (!same_store(record.folder, ref)) continue
			record.steps.forEach(follow)
			record.folder = { ...record.folder, folder_id: rebase_path(record.folder.folder_id, from, to) }
		}
	}

	async function run(direction: 'undo' | 'redo') {
		await idle()
		const from = direction === 'undo' ? undo_stack : redo_stack
		const record = from.pop()
		if (!record) {
			if (direction === 'undo' && blocked_label) emit({ type: 'blocked', label: blocked_label })
			return
		}
		const ref = { drive_id: record.folder.drive_id, root_id: record.folder.root_id }
		const borrowed = await deps.borrow(ref).catch(() => null)
		if (!borrowed) {
			emit({ type: 'unreachable', record, direction })
			return
		}
		const at_start = commits
		replaying = true
		try {
			// Undo checks that each thing is still as the action left it and writes
			// it back; redo checks that it is as the undo left it
			const expect: Side = direction === 'undo' ? 'after' : 'before'
			const write: Side = direction === 'undo' ? 'before' : 'after'
			const order = direction === 'undo' ? [...record.steps].reverse() : [...record.steps]
			const reads = fresh_reads(borrowed.store.file_manager)
			const matches = await Promise.all(order.map(step => step_matches(step, expect, reads, order).catch(() => false)))

			const skipped = new Set<HistoryStep>()
			const skipped_keys = new Set<string>()
			const skip = (step: HistoryStep) => {
				skipped.add(step)
				for (const key of step_keys(step)) skipped_keys.add(key)
			}
			order.forEach((step, index) => {
				if (!matches[index]) skip(step)
			})
			// What depends on a thing left alone is left alone too: a folder that
			// did not come back takes nothing back into it
			for (let grew = skipped.size > 0; grew;) {
				grew = false
				for (const step of order) {
					if (skipped.has(step) || !depends_on(step, skipped_keys)) continue
					skip(step)
					grew = true
				}
			}

			const done: HistoryStep[] = []
			const messages: string[] = []
			let failed = 0
			for (const step of order) {
				if (skipped.has(step)) continue
				const applied: Applied = await apply_step(borrowed.store, step, write).catch(() => ({ ok: false as const }))
				if (applied.ok) {
					done.push(step)
					if (step.kind === 'entry_move') {
						const moved_from = write === 'before' ? step.to : step.from
						const moved_to = applied.rebase?.to ?? (write === 'before' ? step.from : step.to)
						deps.on_moved?.(ref, moved_from, moved_to)
					}
					if (applied.rebase) rebase(ref, applied.rebase.from, applied.rebase.to, record)
					continue
				}
				const missed = applied as Extract<Applied, { ok: false }>
				// Someone touched it between the check and the write: left as it is
				if (missed.skipped) skip(step)
				else {
					failed += 1
					if (missed.message) messages.push(missed.message)
				}
			}
			const kept = direction === 'undo' ? done.reverse() : done
			if (kept.length > 0 && commits === at_start) {
				const to = direction === 'undo' ? redo_stack : undo_stack
				to.push({ ...record, steps: kept, updated_at: now() })
				last_committed = null
			}
			let skipped_objects = 0
			for (const step of skipped) skipped_objects += object_count(step)
			emit({
				type: direction === 'undo' ? 'undone' : 'redone',
				record,
				store: borrowed.store,
				applied: kept.length,
				skipped: skipped_objects,
				failed,
				messages,
				affected: affected_entries(kept, write),
			})
		} finally {
			replaying = false
			borrowed.release()
		}
	}

	/**
	 * Forgets that the latest action made `id` (a text block left empty is
	 * removed again by itself: nothing happened). True when it was there to
	 * forget
	 */
	function drop_created(ref: HistoryStoreRef | null | undefined, id: string): boolean {
		if (!ref) return false
		const top = undo_stack[undo_stack.length - 1]
		if (!top || last_committed !== top.id || !same_store(top.folder, ref)) return false
		const index = top.steps.findIndex(step => step.kind === 'entry_create' && step.id === id)
		if (index === -1) return false
		top.steps.splice(index, 1)
		if (top.steps.length === 0) undo_stack.pop()
		return true
	}

	/** Undoes run one after another: five presses, five undos */
	function enqueue(direction: 'undo' | 'redo'): Promise<void> {
		queue = queue.then(() => run(direction)).catch((error) => {
			console.error('[history] undo failed', error)
		})
		return queue
	}

	return {
		transact,
		record_applied,
		barrier,
		amend_attr,
		drop_created,
		undo: () => enqueue('undo'),
		redo: () => enqueue('redo'),
		get can_undo() {
			return undo_stack.length > 0
		},
		get can_redo() {
			return redo_stack.length > 0
		},
		/** The record the next undo takes */
		get top_id(): number | null {
			return undo_stack[undo_stack.length - 1]?.id ?? null
		},
		/** An undo or redo is writing its steps */
		get replaying() {
			return replaying
		},
		on(listener: (event: HistoryEvent<S>) => void): () => void {
			listeners.add(listener)
			return () => listeners.delete(listener)
		},
		/** Forgets everything (tests; a new account) */
		clear() {
			undo_stack.length = 0
			redo_stack.length = 0
			blocked_label = null
			last_committed = null
			commits += 1
		},
		/** For tests: the records, oldest first */
		snapshot() {
			return { undo: undo_stack.map(record => ({ ...record })), redo: redo_stack.map(record => ({ ...record })) }
		},
	}
}

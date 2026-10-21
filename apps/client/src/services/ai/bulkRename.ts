import type { WorkspaceStore } from '@/domain/Store'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import { AiError } from './types'
import type { NameEntry } from './suggestName'

export type BulkRowStatus =
	/** not asked yet */
	| 'waiting'
	| 'asking'
	/** a new name to review */
	| 'ready'
	/** the model kept the current name */
	| 'same'
	/** nothing to send (empty note, undecodable image, model without vision) */
	| 'skipped'
	| 'failed'
	/** the batch was stopped before this row was asked */
	| 'stopped'
	| 'renamed'
	| 'rename_failed'

export type BulkRow = {
	entry: NameEntry
	status: BulkRowStatus
	suggestion: string | null
	reason: string | null
	checked: boolean
}

export function new_row(entry: NameEntry): BulkRow {
	return { entry, status: 'waiting', suggestion: null, reason: null, checked: false }
}

/**
 * The names the checked rows will get, colliding names numbered the app's
 * usual way (`name (1).jpg`). Every current name in the folder stays taken,
 * the batch's own included: renames run one by one, so a row may not take
 * a name another row still holds. A row whose result is its current name
 * maps to that name.
 */
export function planned_names(rows: readonly BulkRow[], sibling_names: Iterable<string>): Map<string, string> {
	const taken = new Set(sibling_names)
	const planned = new Map<string, string>()
	for (const row of rows) {
		if (!row.checked || row.status !== 'ready' || !row.suggestion) continue
		const others = new Set(taken)
		others.delete(row.entry.name)
		const name = resolve_unique_filename(row.suggestion, others)
		taken.add(name)
		planned.set(row.entry.id, name)
	}
	return planned
}

/**
 * Errors that would fail every other row the same way: the server is down,
 * the key is wrong, the account is out of requests. The batch stops on them.
 */
export function is_batch_stopping_error(error: unknown): boolean {
	return error instanceof AiError && (
		error.kind === 'connect'
		|| error.kind === 'certificate'
		|| error.kind === 'unauthorized'
		|| error.kind === 'rate_limited'
		|| error.kind === 'invalid_url'
		|| error.kind === 'keyring'
		|| error.kind === 'keyring_denied'
	)
}

/** Runs `worker` over `items`, at most `concurrency` at a time, starting none after `signal` aborts. */
export async function run_pool<T>(
	items: readonly T[],
	concurrency: number,
	worker: (item: T) => Promise<void>,
	signal?: AbortSignal,
): Promise<void> {
	let next = 0
	const lane = async () => {
		while (next < items.length && !signal?.aborted) {
			const item = items[next++]!
			await worker(item)
		}
	}
	await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, lane))
}

/**
 * Renames one entry through the store and says whether it worked. The store
 * reports a failure in `last_error` rather than throwing; that is read here
 * and the previous value restored, so a batch does not leave one banner per
 * failed file. Success means the new name is in the folder.
 */
export async function rename_entry(
	workspace: Pick<WorkspaceStore, 'rename' | 'resolve_folder_data' | 'last_error'>,
	folder_id: string,
	entry_id: string,
	name: string,
): Promise<string | null> {
	const previous_error = workspace.last_error
	workspace.last_error = null
	try {
		await workspace.rename(entry_id, name)
	} catch (error) {
		workspace.last_error = previous_error
		return error instanceof Error ? error.message : String(error)
	}
	const error = workspace.last_error
	workspace.last_error = previous_error
	if (error) return error
	const present = workspace.resolve_folder_data(folder_id)?.children.some(child => child.name === name)
	return present ? null : 'The file was moved or removed meanwhile'
}

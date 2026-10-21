import type { WorkspaceStore } from '@/domain/Store'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import { AiError } from './types'
import type { NameEntry } from './suggestName'

export type BulkRowStatus =
	/** not read yet */
	| 'waiting'
	/** the note, folder or image is being read (an image reduced) */
	| 'preparing'
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
 * How APFS and NTFS compare names: ignoring case, and ignoring how a letter
 * is composed (`й` as one code point or `и` plus a combining breve; files
 * from old HFS disks, zips and some clouds arrive decomposed).
 */
const fold = (name: string) => name.normalize('NFC').toLowerCase()
const same_name = (a: string, b: string) => fold(a) === fold(b)

/**
 * The names the checked rows will get, colliding names numbered the app's
 * usual way (`name (1).jpg`). Names are compared ignoring case: on the
 * default macOS file system `Beach.jpg` would replace `beach.jpg`. Every
 * current name in the folder stays taken, the batch's own included: renames
 * run one by one, so a row may not take a name another row still holds.
 * A row's own name is free to it, so a change of case alone stays as is.
 */
export function planned_names(rows: readonly BulkRow[], sibling_names: Iterable<string>): Map<string, string> {
	const taken = [...sibling_names]
	const planned = new Map<string, string>()
	for (const row of rows) {
		if (!row.checked || row.status !== 'ready' || !row.suggestion) continue
		const others = taken.filter(name => !same_name(name, row.entry.name))
		const name = resolve_unique_filename(row.suggestion, others, { ignore_case: true })
		taken.push(name)
		planned.set(row.entry.id, name)
	}
	return planned
}

/**
 * Errors that would fail every other row the same way: the server is down
 * or hangs, the address or model is wrong, the key is refused, the account
 * is out of requests. The batch stops on them.
 */
export function is_batch_stopping_error(error: unknown): boolean {
	return error instanceof AiError && (
		error.kind === 'connect'
		|| error.kind === 'certificate'
		|| error.kind === 'timeout'
		|| error.kind === 'not_found'
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

export const NAME_TAKEN_MEANWHILE = 'Name taken meanwhile'

/**
 * Renames one entry and says whether it worked. Right before the rename the
 * folder is checked again, ignoring case: a file synced in during the
 * review may hold the name now, and is never replaced. The store throws
 * instead of raising its toast (`report: false`); success means the new
 * name is in the folder.
 */
export async function rename_entry(
	workspace: Pick<WorkspaceStore, 'rename' | 'resolve_folder_data'>,
	folder_id: string,
	entry_id: string,
	name: string,
): Promise<string | null> {
	const children = workspace.resolve_folder_data(folder_id)?.children ?? []
	if (children.some(child => child.id !== entry_id && same_name(child.name, name))) return NAME_TAKEN_MEANWHILE
	try {
		await workspace.rename(entry_id, name, { report: false })
	} catch (error) {
		return error instanceof Error ? error.message : String(error)
	}
	const present = workspace.resolve_folder_data(folder_id)?.children
		.some(child => child.name.normalize('NFC') === name.normalize('NFC'))
	return present ? null : 'The file was moved or removed meanwhile'
}

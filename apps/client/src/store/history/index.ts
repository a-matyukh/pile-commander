import type { WorkspaceStore } from '@/domain/Store'
import { count_items, t } from '@/i18n'
import { find_entry_owner_folder } from '@/services/workspace/xattrs'
import { create_history, type TransactMeta } from './history'
import type { HistoryStep, HistoryTx } from './types'

export type { HistoryStep, HistoryTx, HistoryRecord, HistoryStoreRef } from './types'
export type { HistoryEvent } from './history'

/**
 * The window's undo history. A record's store is borrowed from Drive while
 * an undo writes it: opened without showing it, and held so a sweep does not
 * close it meanwhile. Drive is imported on demand: it builds the stores that
 * write into this history
 */
export const history = create_history<WorkspaceStore>({
	async borrow(ref) {
		const { explorer_drives } = await import('@/store/explorer/drives')
		const prepared = await explorer_drives.prepare(ref.drive_id, ref.root_id)
		return { store: prepared.store, release: () => prepared.release() }
	},
})

/** The entry's name as the person sees it: its listing in the owner folder, or the path's last part */
export function entry_name(ws: Pick<WorkspaceStore, 'opened_folder' | 'preview_folders'>, id: string): string {
	const owner = find_entry_owner_folder(ws.opened_folder, ws.preview_folders, id)
	const listed = owner?.id === id ? owner.name : owner?.children?.find(child => child.id === id)?.name
	if (listed) return listed
	const parts = id.split(/[\\/]/).filter(Boolean)
	return parts[parts.length - 1] ?? id
}

/** "перемещение «Note»" for one entry, "перемещение: 3 элемента" for several */
export function entries_label(
	ws: Pick<WorkspaceStore, 'opened_folder' | 'preview_folders'>,
	ids: readonly string[],
	one_key: string,
	many_key: string,
): string {
	return ids.length === 1
		? t(one_key, { name: entry_name(ws, ids[0]!) })
		: t(many_key, { count: count_items(ids.length) })
}

function action_meta(
	ws: WorkspaceStore,
	where: { folder_id?: string; entry_id?: string },
	label: string,
	merge_key?: string,
): TransactMeta | null {
	const ref = ws.history_ref
	if (!ref || !ws.can_write) return null
	const owner = where.entry_id
		? find_entry_owner_folder(ws.opened_folder, ws.preview_folders, where.entry_id)?.id
		: undefined
	const folder_id = where.folder_id ?? owner ?? ws.opened_folder_id
	const folder_name = folder_id === ws.id ? ws.name : (ws.resolve_folder_data(folder_id)?.name ?? ws.name)
	return { label, folder: { ...ref, folder_id }, folder_name, merge_key }
}

/**
 * Runs one action of the person's as one record of the window's history:
 * the store methods `fn` calls with `{ tx }` write their steps into it.
 * `where`: the folder it happens in, or an entry whose folder it is. A store
 * outside the Explorer (no `history_ref`) or a read-only one records nothing
 */
export function record_action<T>(
	ws: WorkspaceStore,
	where: { folder_id?: string; entry_id?: string },
	label: string,
	fn: (tx: HistoryTx | undefined) => Promise<T>,
	options?: { merge_key?: string },
): Promise<T> {
	return history.transact(action_meta(ws, where, label, options?.merge_key), fn)
}

/**
 * Keeps an action that is already saved as one record: the note editor
 * window saves as the person types, and its whole session is one undo
 */
export function record_done(
	ws: WorkspaceStore,
	where: { folder_id?: string; entry_id?: string },
	label: string,
	steps: HistoryStep[],
): void {
	const meta = action_meta(ws, where, label)
	if (meta) history.record_applied(meta, steps)
}

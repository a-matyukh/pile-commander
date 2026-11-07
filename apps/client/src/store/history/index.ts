import type { WorkspaceStore } from '@/domain/Store'
import { count_items, t } from '@/i18n'
import { find_entry_owner_folder } from '@/services/workspace/xattrs'
import { create_history, type TransactMeta } from './history'
import { parent_path, rebase_path, within } from './steps'
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
	// Bookmarks follow a folder an undo moved back, and so does the place on
	// screen when it was inside it, as the tree's own moves do
	on_moved(ref, from, to) {
		void (async () => {
			const [{ retarget_bookmarks }, { explorer_navigation }] = await Promise.all([
				import('@/store/explorer/bookmarks'),
				import('@/store/explorer/navigation'),
			])
			retarget_bookmarks({ ...ref, folder_id: from }, { ...ref, folder_id: to })
			const location = explorer_navigation.location
			if (location?.kind !== 'folder') return
			const here = location.ref
			if (here.drive_id !== ref.drive_id || here.root_id !== ref.root_id) return
			const next = rebase_path(here.folder_id, from, to)
			if (next !== here.folder_id) await explorer_navigation.open_folder({ ...here, folder_id: next })
		})()
	},
	// A folder back from the trash gets back the bookmarks its delete took
	on_restored(ref, was, back) {
		void import('@/store/explorer/bookmarks').then(({ bring_back_bookmarks }) => {
			bring_back_bookmarks({ ...ref, folder_id: back }, was)
		})
	},
	// A redo trashes it again: its bookmarks go, and the place on screen
	// inside it goes to the folder it was in
	on_removed(ref, id) {
		void (async () => {
			const [{ forget_bookmarks }, { explorer_navigation }] = await Promise.all([
				import('@/store/explorer/bookmarks'),
				import('@/store/explorer/navigation'),
			])
			forget_bookmarks({ ...ref, folder_id: id })
			const location = explorer_navigation.location
			if (location?.kind !== 'folder') return
			const here = location.ref
			if (here.drive_id !== ref.drive_id || here.root_id !== ref.root_id) return
			if (!within(here.folder_id, id)) return
			await explorer_navigation.open_folder({ ...here, folder_id: parent_path(id) })
		})()
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
	options?: { merge_key?: string; notice?: string },
): TransactMeta | null {
	const ref = ws.history_ref
	if (!ref || !ws.can_write) return null
	const owner = where.entry_id
		? find_entry_owner_folder(ws.opened_folder, ws.preview_folders, where.entry_id)?.id
		: undefined
	const folder_id = where.folder_id ?? owner ?? ws.opened_folder_id
	const folder_name = folder_id === ws.id ? ws.name : (ws.resolve_folder_data(folder_id)?.name ?? ws.name)
	return { label, folder: { ...ref, folder_id }, folder_name, merge_key: options?.merge_key, notice: options?.notice }
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
	options?: { merge_key?: string; notice?: string },
): Promise<T> {
	return history.transact(action_meta(ws, where, label, options), fn)
}

/**
 * A file operation of the store: part of the action that passed `tx`, or one
 * action of its own. While an undo writes its steps, it records nothing
 */
export function own_action<T>(
	ws: WorkspaceStore,
	tx: HistoryTx | undefined,
	where: { folder_id?: string; entry_id?: string },
	label: () => string,
	fn: (tx: HistoryTx | undefined) => Promise<T>,
	options?: { notice?: () => string },
): Promise<T> {
	if (tx || history.replaying) return fn(tx)
	return record_action(ws, where, label(), fn, { notice: options?.notice?.() })
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

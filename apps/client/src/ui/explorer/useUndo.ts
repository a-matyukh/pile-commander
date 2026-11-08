import { onUnmounted } from 'vue'
import { useEventListener } from '@vueuse/core'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { plural_form, t } from '@/i18n'
import { explorer_navigation } from '@/store/explorer/navigation'
import { history, type HistoryEvent } from '@/store/history'
import { keys_elsewhere } from './folder_keys'

type KeyLike = Pick<KeyboardEvent, 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>

/**
 * ⌘Z / Ctrl+Z undoes, ⇧⌘Z / Ctrl+Shift+Z and Ctrl+Y redo. Matched by the
 * key's place (`code`), so a Russian layout works the same
 */
export function undo_key(event: KeyLike): 'undo' | 'redo' | null {
	if (event.altKey || !(event.metaKey || event.ctrlKey)) return null
	if (event.code === 'KeyZ') return event.shiftKey ? 'redo' : 'undo'
	if (event.code === 'KeyY' && !event.shiftKey) return 'redo'
	return null
}

export type UndoToaster = {
	add(toast: {
		title: string
		color?: 'neutral' | 'warning' | 'error'
		icon?: string
		actions?: { label: string; onClick: () => void }[]
	}): unknown
	remove?(id: string | number): void
}

/** The toast that offers to undo the last action: it goes once anything newer happens */
let notice_toast: string | number | null = null

function drop_notice(toast: UndoToaster) {
	if (notice_toast !== null) toast.remove?.(notice_toast)
	notice_toast = null
}

function parent_of(folder_id: string): string {
	const parent = folder_id.replace(/[\\/][^\\/]*$/, '')
	return parent === '' ? '/' : parent
}

/** The folder is open on screen, or shows as a preview inside the open one */
export function on_screen(folder: FolderRef): boolean {
	const location = explorer_navigation.location
	if (location?.kind !== 'folder') return false
	const here = location.ref
	if (here.drive_id !== folder.drive_id || here.root_id !== folder.root_id) return false
	return here.folder_id === folder.folder_id || parent_of(folder.folder_id) === here.folder_id
}

/** What a toast says after an undo, a redo, or an undo that cannot go further */
export function show_history_event(event: HistoryEvent<WorkspaceStore>, toast: UndoToaster) {
	drop_notice(toast)
	if (event.type === 'recorded') {
		const { record } = event
		if (!record.notice) return
		// "Перенесено: «Note»" · Отменить — while it is still the last action
		const shown = toast.add({
			title: record.notice,
			actions: [{
				label: t('undo.undo_action'),
				onClick: () => {
					if (history.top_id === record.id) void history.undo()
				},
			}],
		}) as { id?: string | number } | undefined
		notice_toast = shown?.id ?? null
		return
	}
	if (event.type === 'blocked') {
		toast.add({ title: t('undo.blocked', { label: event.label }), icon: 'i-lucide:undo-2' })
		return
	}
	if (event.type === 'unreachable') {
		toast.add({ title: t('undo.unreachable', { label: event.record.label }), color: 'error' })
		return
	}
	const { record, store } = event
	const undo = event.type === 'undone'
	if (event.applied > 0) {
		if (on_screen(record.folder)) {
			// On screen the change shows itself; what came back is selected
			const location = explorer_navigation.location
			const shown = new Set((store?.opened_folder.children ?? []).map(child => child.id))
			const ids = event.affected.filter(id => shown.has(id))
			if (store && ids.length > 0 && location?.kind === 'folder' && store.opened_folder_id === location.ref.folder_id) {
				store.set_selection(ids)
			}
		} else {
			toast.add({
				title: t(undo ? 'undo.undone_in' : 'undo.redone_in', { folder: record.folder_name, label: record.label }),
				icon: undo ? 'i-lucide:undo-2' : 'i-lucide:redo-2',
				actions: [{ label: t('undo.show'), onClick: () => void explorer_navigation.open_folder(record.folder) }],
			})
		}
	}
	if (event.skipped > 0) {
		toast.add({ title: t(`undo.skipped.${plural_form(event.skipped)}`, { n: event.skipped }), color: 'warning' })
	}
	if (event.failed > 0) {
		// a step that knows why ("Исходный файл изменился") says it; the rest, in general
		const said = new Set(event.messages)
		for (const message of said) toast.add({ title: message, color: 'error' })
		if (said.size < event.failed) {
			toast.add({ title: t(undo ? 'undo.failed' : 'undo.redo_failed', { label: record.label }), color: 'error' })
		}
	}
}

/**
 * The window's ⌘Z: undo and redo of the person's actions, and the toasts
 * that say what happened. Text keeps its own ⌘Z: a note, a text field, an
 * open menu or dialog, and the note editor window are left alone
 */
export function use_undo(toast: UndoToaster) {
	useEventListener(window, 'keydown', (event: KeyboardEvent) => {
		const action = undo_key(event)
		if (!action || event.defaultPrevented || keys_elsewhere(event)) return
		const location = explorer_navigation.location
		if (location?.kind === 'folder' && location.file_id) return
		// The app's own Edit menu would send its native undo too
		event.preventDefault()
		void (action === 'undo' ? history.undo() : history.redo())
	})
	const off = history.on(event => show_history_event(event, toast))
	onUnmounted(off)
}

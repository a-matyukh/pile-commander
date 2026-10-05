import { onMounted, onUnmounted, toValue, type MaybeRefOrGetter } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { entry_clipboard } from '@/store/entryClipboard'

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function isModKey(event: KeyboardEvent): boolean {
	return event.metaKey || event.ctrlKey
}

/**
 * File clipboard shortcuts: Ctrl/Cmd+C/X/V/D. The clipboard itself is global
 * (entry_clipboard), so entries travel between desktop boards and workspace
 * windows; `is_active` decides which mounted instance answers. Selection
 * actions (c/x/d) self-guard by each store's own selection, so overlapping
 * instances are harmless; paste has no such guard, so exactly one instance
 * may claim it (the focused window wins, the desktop board takes it only
 * when no window is focused).
 */
export function useClipboardShortcuts(
	workspace: MaybeRefOrGetter<WorkspaceStore | null>,
	is_active: (action: 'paste' | 'selection') => boolean,
) {
	function onKeyDown(event: KeyboardEvent) {
		const ws = toValue(workspace)
		if (!ws) return
		if (event.defaultPrevented) return
		if (isTypingTarget(event.target)) return
		if (!isModKey(event) || event.altKey || event.shiftKey) return

		const key = event.key.toLowerCase()
		if (key !== 'c' && key !== 'x' && key !== 'v' && key !== 'd') return
		// copy stays available in read-only workspaces; paste/cut/duplicate don't
		if (key !== 'c' && !ws.can_write) return

		if (key === 'v') {
			if (!is_active('paste')) return
			if (!entry_clipboard.current?.entry_ids.length) return
			event.preventDefault()
			void ws.paste()
			return
		}
		if (!is_active('selection')) return

		const child_ids = new Set((ws.opened_folder.children ?? []).map(c => c.id))
		const ids = ws.selection.filter(id => child_ids.has(id))
		if (ids.length === 0) return

		event.preventDefault()
		if (key === 'c') ws.copy_entries(ids)
		else if (key === 'x') ws.cut_entries(ids)
		else void ws.duplicate_entries(ids)
	}

	onMounted(() => {
		window.addEventListener('keydown', onKeyDown)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown)
	})
}

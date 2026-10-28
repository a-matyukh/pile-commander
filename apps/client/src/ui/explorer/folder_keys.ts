import { useEventListener } from '@vueuse/core'
import type { ComputedRef } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidget, FolderView } from '@/domain/Widget'
import { normalize_workspace_id, parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { root_folder_id } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'

/** Views where the arrows move the selection; on a board or canvas they move the selected items */
const ARROW_VIEWS: FolderView[] = ['list', 'grid', 'stack', 'masonry']

type Dir = 'up' | 'down' | 'left' | 'right'

const DIRS: Record<string, Dir> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }

/**
 * The nearest item in a direction, by its place on screen: the same for one
 * column (list, stack), a grid (gallery) and uneven columns (masonry).
 * Staying in the same row or column weighs more than the distance
 */
export function neighbor(items: { el: Element; rect: DOMRect }[], from: DOMRect, dir: Dir): Element | null {
	const ax = from.left + from.width / 2
	const ay = from.top + from.height / 2
	let best: Element | null = null
	let best_score = Infinity
	for (const { el, rect } of items) {
		const dx = rect.left + rect.width / 2 - ax
		const dy = rect.top + rect.height / 2 - ay
		const ahead = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx
		if (ahead <= 1) continue
		const side = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy)
		const score = ahead + side * 3
		if (score < best_score) {
			best_score = score
			best = el
		}
	}
	return best
}

/** Typing, a menu or a dialog keeps its keys */
function keys_elsewhere(event: KeyboardEvent): boolean {
	const target = event.target
	if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, [role="menu"], [role="dialog"]'))) return true
	return !!document.querySelector('[role="menu"], [role="dialog"]')
}

/**
 * Keyboard in a folder, as in the prototype:
 * - ⌘↑ opens the parent folder; ⌘↓ or Enter opens the one selected item;
 * - arrows move the selection in the list, gallery, stack and masonry.
 *   In a single column ← / → step to the previous / next item
 */
export function use_folder_keys(
	root: () => HTMLElement | null,
	workspace: ComputedRef<WorkspaceStore | null>,
	container: ComputedRef<FolderContainerWidget | null>,
	location: ComputedRef<FolderRef | null>,
) {
	function open_selected(ws: WorkspaceStore): boolean {
		if (ws.selection.length !== 1) return false
		const widget = container.value?.children.find(child => child.id === ws.selection[0])
		if (!widget) return false
		ws.open(widget)
		return true
	}

	function open_parent(): boolean {
		const ref = location.value
		if (!ref) return false
		const top = root_folder_id(ref)
		const folder = normalize_workspace_id(ref.folder_id)
		if (folder === top) return false
		void explorer_navigation.open_folder({ ...ref, folder_id: parent_folder_id_from_node_id(folder, top) })
		return true
	}

	function move(ws: WorkspaceStore, dir: Dir): boolean {
		const box = root()
		if (!box) return false
		const items = [...box.querySelectorAll('[data-item-id]')]
			.map(el => ({ el, id: (el as HTMLElement).dataset.itemId!, rect: el.getBoundingClientRect() }))
		if (!items.length) return false
		const current = items.find(item => item.id === ws.selection[ws.selection.length - 1])
		let next: (typeof items)[number] | undefined
		if (!current) next = items[0]
		else {
			const el = neighbor(items.filter(item => item !== current), current.rect, dir)
			next = items.find(item => item.el === el)
			if (!next && (dir === 'left' || dir === 'right')) {
				next = items[items.indexOf(current) + (dir === 'left' ? -1 : 1)]
			}
		}
		if (!next) return true
		ws.set_selection([next.id])
		next.el.scrollIntoView({ block: 'nearest' })
		return true
	}

	useEventListener(window, 'keydown', (event: KeyboardEvent) => {
		const ws = workspace.value
		if (!ws || event.altKey || event.shiftKey || keys_elsewhere(event)) return
		const command = event.metaKey || event.ctrlKey
		const dir = DIRS[event.key]
		let handled = false
		if (command && dir === 'up') handled = open_parent()
		else if ((command && dir === 'down') || (!command && event.key === 'Enter')) handled = open_selected(ws)
		else if (!command && dir && ARROW_VIEWS.includes(container.value?.view ?? 'list')) handled = move(ws, dir)
		if (handled) event.preventDefault()
	})
}

import { useEventListener } from '@vueuse/core'
import type { ComputedRef } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidget, FolderView } from '@/domain/Widget'
import { layer_order, layer_step_from_key } from '@/services/board/layerOrder'
import { normalize_workspace_id, parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { root_folder_id } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import { t } from '@/i18n'
import { record_action } from '@/store/history'

/** Views where the arrows move the selection; on a board, canvas or 3D they move the selected items */
const ARROW_VIEWS: FolderView[] = ['list', 'grid', 'stack', 'masonry', 'dashboard']

/** Views where [ and ] change the layer order: in 3D it decides which overlapping card is higher */
const LAYER_VIEWS: FolderView[] = ['board', 'canvas', '3d']

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

/**
 * A menu or dialog that is actually open. The canvas zoom and tool menus stay
 * mounted while closed (`v-show`, `display: none`); a closed layer must not
 * keep F2 from renaming the selected item.
 */
export function menu_layer_open(el: {
	getAttribute(name: string): string | null
	hidden?: boolean
	style?: { display?: string; visibility?: string }
}): boolean {
	if (el.getAttribute('data-state') === 'closed') return false
	if (el.hidden) return false
	if (el.style?.display === 'none' || el.style?.visibility === 'hidden') return false
	return true
}

/** Typing, or a menu or dialog that is open, keeps its keys */
export function keys_elsewhere(event: KeyboardEvent): boolean {
	const target = event.target
	if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select'))) return true
	if (target instanceof Element) {
		const layer = target.closest('[role="menu"], [role="dialog"]')
		if (layer && menu_layer_open(layer)) return true
	}
	return [...document.querySelectorAll('[role="menu"], [role="dialog"]')].some(menu_layer_open)
}

type KeyState = {
	key: string
	repeat: boolean
	metaKey: boolean
	ctrlKey: boolean
	altKey: boolean
	shiftKey: boolean
}

/**
 * F2 renames the one selected item that is on screen. A repeat, a modifier,
 * no selection or several selected items leave the key alone. A selected id
 * the view does not show (a hidden file) does not count.
 */
export function rename_hotkey_target<T extends { id: string }>(
	event: KeyState,
	selection: readonly string[],
	children: readonly T[],
): T | null {
	if (event.key !== 'F2' || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null
	const visible = children.filter(child => selection.includes(child.id))
	return visible.length === 1 ? visible[0]! : null
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

	function restack(ws: WorkspaceStore, step: ReturnType<typeof layer_step_from_key>): boolean {
		const folder = container.value
		if (!step || !folder || !LAYER_VIEWS.includes(folder.view) || !ws.can_write) return false
		const ids = folder.children.map(child => child.id)
		const moving = ws.selection.filter(id => ids.includes(id))
		if (!moving.length) return false
		const next = layer_order(ids, moving, step)
		if (!next) return true
		void record_action(ws, { folder_id: folder.id }, t('undo.layers'), tx => ws.reorder_children(folder.id, next, { tx }))
		return true
	}

	useEventListener(window, 'keydown', (event: KeyboardEvent) => {
		const ws = workspace.value
		if (!ws || event.altKey || event.shiftKey || keys_elsewhere(event)) return
		const command = event.metaKey || event.ctrlKey
		const dir = DIRS[event.key]
		const step = layer_step_from_key(event)
		let handled = false
		if (command && dir === 'up') handled = open_parent()
		else if ((command && dir === 'down') || (!command && event.key === 'Enter')) handled = open_selected(ws)
		else if (!command && dir && ARROW_VIEWS.includes(container.value?.view ?? 'list')) handled = move(ws, dir)
		else if (step) handled = restack(ws, step)
		if (handled) event.preventDefault()
	})
}

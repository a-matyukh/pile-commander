import { reactive } from 'vue'
import { is_within } from '@/store/explorer/drives'

/**
 * Dragging a folder in the sidebar tree onto another folder moves it there.
 * Pointer events, not HTML5 drag and drop: with Tauri's file drop on, the
 * webview never gets native drop events (the old tree uses Sortable's
 * fallback for the same reason).
 *
 * Within one drive: inside a root, or into another root of the same drive
 * (another cloud workspace, a folder outside ~). Between ~ and the cloud is
 * deferred: the tree shows one drive at a time.
 */

/** A spot in the tree: a folder row, or the empty space of the main root */
export type TreeDropSpot = {
	/** `${drive_id}\0${root_id}` */
	root_key: string
	folder_id: string
}

export type TreeDragSource = TreeDropSpot & {
	name: string
	/** The folder it sits in now: dropping there would change nothing */
	parent_id: string
}

/** Pointer travel before a press becomes a drag */
const DRAG_START_PX = 4
/** Hovering a collapsed folder this long opens it */
const OPEN_ON_HOVER_MS = 600

export const tree_drag = reactive({
	source: null as TreeDragSource | null,
	target: null as TreeDropSpot | null,
	x: 0,
	y: 0,
})

export const tree_root_key = (drive_id: string, root_id: string) => `${drive_id}\0${root_id}`

const drive_of = (root_key: string) => root_key.slice(0, root_key.indexOf('\0'))

/**
 * Where a folder may land: the same drive; within its own root, not on itself,
 * inside itself or where it already is. Ids of another root are its own paths
 * (a cloud workspace starts at "/"), so they never nest with the source
 */
export function can_drop(source: TreeDragSource, spot: TreeDropSpot): boolean {
	if (spot.root_key !== source.root_key) return drive_of(spot.root_key) === drive_of(source.root_key)
	return !is_within(spot.folder_id, source.folder_id)
		&& spot.folder_id !== source.parent_id
}

export const is_drop_target = (spot: TreeDropSpot) =>
	tree_drag.target !== null
	&& tree_drag.target.root_key === spot.root_key
	&& tree_drag.target.folder_id === spot.folder_id

/** Rows that can open while a drag hovers them, by spot */
const openers = new Map<string, () => void>()
const spot_key = (spot: TreeDropSpot) => `${spot.root_key}\0${spot.folder_id}`

export function register_drop_opener(spot: TreeDropSpot, open: () => void): () => void {
	const key = spot_key(spot)
	openers.set(key, open)
	return () => {
		if (openers.get(key) === open) openers.delete(key)
	}
}

/** The drop spot under a point: elements carry data-drop-root and data-drop-folder */
function spot_at(x: number, y: number): TreeDropSpot | null {
	const element = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-root]')
	const root_key = element?.dataset.dropRoot
	const folder_id = element?.dataset.dropFolder
	return root_key && folder_id ? { root_key, folder_id } : null
}

/**
 * Starts tracking a press on a row. It becomes a drag after a few pixels;
 * a press that never moves stays a click. `drop` runs on a valid release.
 * Escape cancels
 */
export function press_tree_row(
	event: PointerEvent,
	source: TreeDragSource,
	drop: (target: TreeDropSpot) => void,
) {
	if (event.button !== 0 || tree_drag.source) return
	const pointer_id = event.pointerId
	const start_x = event.clientX
	const start_y = event.clientY
	let dragging = false
	let hover_key = ''
	let hover_timer: ReturnType<typeof setTimeout> | null = null

	const clear_hover = () => {
		if (hover_timer) clearTimeout(hover_timer)
		hover_timer = null
		hover_key = ''
	}

	const move = (e: PointerEvent) => {
		if (e.pointerId !== pointer_id) return
		// Released outside the window: no pointerup reached us
		if ((e.buttons & 1) === 0) {
			finish(false)
			return
		}
		if (!dragging) {
			if (Math.hypot(e.clientX - start_x, e.clientY - start_y) < DRAG_START_PX) return
			dragging = true
			tree_drag.source = source
			document.body.classList.add('tree-dragging')
		}
		tree_drag.x = e.clientX
		tree_drag.y = e.clientY
		const spot = spot_at(e.clientX, e.clientY)
		tree_drag.target = spot && can_drop(source, spot) ? spot : null
		const key = tree_drag.target ? spot_key(tree_drag.target) : ''
		if (key !== hover_key) {
			clear_hover()
			hover_key = key
			const open = openers.get(key)
			if (open) hover_timer = setTimeout(open, OPEN_ON_HOVER_MS)
		}
	}

	let finished = false
	const finish = (commit: boolean) => {
		if (finished) return
		finished = true
		window.removeEventListener('pointermove', move)
		window.removeEventListener('pointerup', up)
		window.removeEventListener('pointercancel', pointer_cancel)
		window.removeEventListener('keydown', key)
		window.removeEventListener('blur', cancel)
		clear_hover()
		const target = tree_drag.target
		tree_drag.source = null
		tree_drag.target = null
		document.body.classList.remove('tree-dragging')
		if (!dragging) return
		// The click that follows a drag's pointerup must not open the row
		window.addEventListener('click', swallow_click, { capture: true, once: true })
		setTimeout(() => window.removeEventListener('click', swallow_click, { capture: true }), 0)
		if (commit && target) drop(target)
	}
	const up = (e: PointerEvent) => {
		if (e.pointerId === pointer_id) finish(true)
	}
	// The window lost focus (another app, a system dialog): the drag is over
	const cancel = () => finish(false)
	const pointer_cancel = (e: PointerEvent) => {
		if (e.pointerId === pointer_id) finish(false)
	}
	const key = (e: KeyboardEvent) => {
		if (e.key === 'Escape') finish(false)
	}

	window.addEventListener('pointermove', move)
	window.addEventListener('pointerup', up)
	window.addEventListener('pointercancel', pointer_cancel)
	window.addEventListener('keydown', key)
	window.addEventListener('blur', cancel)
}

function swallow_click(e: MouseEvent) {
	e.stopPropagation()
	e.preventDefault()
}

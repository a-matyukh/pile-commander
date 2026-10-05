import { nextTick, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { FolderContainerWidgetChild, Position } from '@/domain/Widget'
import type { WorkspaceStore } from '@/domain/Store'
import { board_position, snap_position, type BoardSnap } from '@/services/board/layout'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { findDropFolder, tryDropOnFolder, type FolderDropOptions } from '../folderDrop'
import {
	applyGroupDragDelta,
	relativePositionsForFolderDrop,
	type GroupDragMember,
} from './boardGroupDrag'
import { blockGhostClick, blockGhostContextMenu } from './blockGhostClick'

export type { BoardSnap }

function parsePx(value: string): number {
	return Number.parseFloat(value.replace('px', '')) || 0
}

/**
 * Keep widgets in content coords of the expanding board (board-extent grows
 * with positions). Do not clamp to the parent's visible client box — that
 * jumps widgets that sit past the scrollport.
 */
export function clampBoardPosition(position: Position): Position {
	return {
		x: Math.max(0, position.x),
		y: Math.max(0, position.y),
	}
}

/**
 * Match ignore/allow selectors. Supports simple comma lists.
 * Prefer a single class like `.board-no-drag` over complex `a b *` selectors —
 * `Element.closest()` does not accept descendant combinators.
 */
function matchesWithin(root: HTMLElement, target: Element, selector: string): boolean {
	for (const part of selector.split(',')) {
		const sel = part.trim()
		if (!sel || sel.includes(' ')) continue
		try {
			if (target.matches(sel) && root.contains(target)) return true
			const match = target.closest(sel)
			if (match instanceof Element && root.contains(match)) return true
		} catch {
			// invalid selector — ignore
		}
	}
	return false
}

type BoardDragController = {
	setEnabled: (enabled: boolean) => void
	setSnap: (snap: BoardSnap) => void
	destroy: () => void
}

const controllers = new WeakMap<HTMLElement, BoardDragController>()

type BoardDragBindingOptions = {
	widget: MaybeRefOrGetter<FolderContainerWidgetChild>
	index: MaybeRefOrGetter<number>
	dragPositions: Ref<Record<string, Position>>
	/** Window-scoped workspace getter, captured at setup (handlers can't inject). */
	getWorkspace: () => WorkspaceStore
	allowFrom?: string | false
	ignoreFrom?: string
	enabled: boolean
	snap: BoardSnap
	/** Touch/pen tap (no drag). Mouse still uses the normal click path. */
	onTap?: (event: PointerEvent) => void
}

const listenerOpts: AddEventListenerOptions = { capture: true }
const bubbleOpts: AddEventListenerOptions = { capture: false }

/** Mouse: tight threshold. Touch: looser so a drag isn't declared on jitter. */
const DRAG_THRESHOLD_MOUSE_PX = 3
const DRAG_THRESHOLD_TOUCH_PX = 10
/** Any movement past this cancels our long-press (menu is hold-still only). */
const LONG_PRESS_CANCEL_PX = 3
/** Match Reka ContextMenuRoot default `pressOpenDelay`. */
const LONG_PRESS_MS = 700

/**
 * Pointer-based board drag.
 * The widget only owns the capture-phase pointerdown (so ContextMenu / child
 * handlers cannot swallow it); move/up/cancel are tracked on `window` during
 * the gesture, so a pointerup outside the widget — or a failed pointer
 * capture — can never leave the drag stuck. Writes left/top directly during
 * the gesture so movement does not depend on Vue style reactivity mid-drag.
 *
 * Multi-select: when the dragged widget is in workspace.selection with ≥2
 * siblings from the same board section, the whole group translates together.
 * Companions update via shared `dragPositions` plus direct left/top writes.
 * Folder-drop onto a preview repositions from the primary's drop point while
 * preserving each companion's seed offset from the primary.
 *
 * Touch tap / long-press are handled here (not via Reka's built-in hold):
 * Reka cancels on any pointermove / pointercancel, and a scrollable ancestor
 * often cancels the gesture before pressOpenDelay. Tap selection uses `onTap`;
 * hold dispatches `contextmenu` for UContextMenu / ContextMenuTrigger.
 *
 * While dragging, cancel our long-press on any meaningful movement and disable
 * Reka's hold on board widgets (pressOpenDelay: Infinity) so a drag cannot be
 * followed by an unwanted context menu.
 */
export function bindBoardDrag(el: HTMLElement, options: BoardDragBindingOptions) {
	unbindBoardDrag(el)

	const { dragPositions } = options
	let enabled = options.enabled
	let snap = options.snap
	let highlightedFolder: HTMLElement | null = null
	let dragging = false
	let moved = false
	/** Long-press opened the context menu — don't promote to drag / skip tap. */
	let holdMenuOpened = false
	let longPressTimer: ReturnType<typeof setTimeout> | null = null
	let pointerId: number | null = null
	let pointerType: string = 'mouse'
	let dragThresholdPx = DRAG_THRESHOLD_MOUSE_PX
	let lastClientX = 0
	let lastClientY = 0
	let activeId: string | null = null
	// Unsnapped position accumulated over the gesture. Snapping must be applied
	// to this raw value, not per-move deltas — rounding increments smaller than
	// the grid step would discard them and freeze the widget.
	let rawX = 0
	let rawY = 0
	/** Start positions for every member of the current multi-drag (incl. primary). */
	let groupStarts: Record<string, Position> = {}
	let groupIds: string[] = []

	function clearFolderHighlight() {
		highlightedFolder?.classList.remove('drop-target')
		highlightedFolder = null
	}

	function clearLongPressTimer() {
		if (longPressTimer === null) return
		clearTimeout(longPressTimer)
		longPressTimer = null
	}

	function clearGroupDragPositions() {
		for (const id of groupIds) {
			delete dragPositions.value[id]
		}
		groupIds = []
		groupStarts = {}
	}

	function openContextMenuAt(clientX: number, clientY: number) {
		holdMenuOpened = true
		el.dispatchEvent(new MouseEvent('contextmenu', {
			bubbles: true,
			cancelable: true,
			composed: true,
			clientX,
			clientY,
			screenX: clientX,
			screenY: clientY,
			button: 2,
			buttons: 2,
			view: window,
		}))
	}

	function applyVisualPosition(position: Position) {
		el.style.left = `${position.x}px`
		el.style.top = `${position.y}px`
	}

	function addWindowListeners() {
		window.addEventListener('pointermove', onPointerMove, listenerOpts)
		window.addEventListener('pointerup', onPointerUp, listenerOpts)
		window.addEventListener('pointercancel', onPointerCancel, listenerOpts)
		window.addEventListener('blur', onWindowBlur)
	}

	function removeWindowListeners() {
		window.removeEventListener('pointermove', onPointerMove, listenerOpts)
		window.removeEventListener('pointerup', onPointerUp, listenerOpts)
		window.removeEventListener('pointercancel', onPointerCancel, listenerOpts)
		window.removeEventListener('blur', onWindowBlur)
	}

	function releaseCapture(pid: number) {
		try {
			if (el.hasPointerCapture(pid)) {
				el.releasePointerCapture(pid)
			}
		} catch {
			// ignore
		}
	}

	function capturePointer(pid: number) {
		try {
			el.setPointerCapture(pid)
		} catch {
			// window listeners still track the pointer without capture
		}
	}

	/** Selected siblings in this board section, or just the active widget. */
	function resolveGroupMembers(primaryId: string): GroupDragMember[] {
		const widget = toValue(options.widget)
		const index = toValue(options.index)
		const primaryStart = dragPositions.value[primaryId]
			?? board_position(widget, index)

		const section = el.closest<HTMLElement>('section[data-path]')
		const folderId = section?.dataset.path
		if (!folderId) {
			return [{ id: primaryId, position: { ...primaryStart } }]
		}

		const ws = options.getWorkspace()
		const folder = ws.resolve_folder_data(folderId)
		if (!folder) {
			return [{ id: primaryId, position: { ...primaryStart } }]
		}
		// Must use the parsed container children (with position xattrs) — raw
		// FolderWithChildrenXattrs entries have no `.position`, so board_position
		// would fall back to the tile grid and companions would jump at seed.
		const children = to_folder_container(folder, ws.preview_folders).children
		const childById = new Map(
			children.map((child, childIndex) => [child.id, { child, childIndex }] as const),
		)

		if (!ws.is_selected(primaryId) || !childById.has(primaryId)) {
			return [{ id: primaryId, position: { ...primaryStart } }]
		}

		const selectedInFolder = ws.selection.filter(id => childById.has(id))
		if (selectedInFolder.length < 2 || !selectedInFolder.includes(primaryId)) {
			return [{ id: primaryId, position: { ...primaryStart } }]
		}

		return selectedInFolder.map((id) => {
			if (id === primaryId) {
				return { id, position: { ...primaryStart } }
			}
			const info = childById.get(id)!
			const peer = section?.querySelector<HTMLElement>(
				`.board-widget[data-id="${CSS.escape(id)}"]`,
			)
			// Prefer live DOM (matches what the user sees) over data, in case a
			// prior gesture left inline styles / dragPositions out of sync.
			if (peer) {
				const left = peer.style.left
				const top = peer.style.top
				if (left && top) {
					return {
						id,
						position: { x: parsePx(left), y: parsePx(top) },
					}
				}
			}
			const position = dragPositions.value[id]
				?? board_position(info.child, info.childIndex)
			return { id, position: { ...position } }
		})
	}

	function seedDragGroup(primaryId: string) {
		const members = resolveGroupMembers(primaryId)
		groupStarts = {}
		groupIds = []
		for (const member of members) {
			groupIds.push(member.id)
			groupStarts[member.id] = { ...member.position }
			dragPositions.value[member.id] = { ...member.position }
		}
	}

	/** Raise the whole drag group above siblings (inline z-index loses to !important). */
	function setGroupDraggingVisual(on: boolean) {
		const section = el.closest<HTMLElement>('section[data-path]')
		const ids = groupIds.length > 0 ? groupIds : (activeId ? [activeId] : [])
		for (const id of ids) {
			const peer = el.dataset.id === id
				? el
				: section?.querySelector<HTMLElement>(
					`.board-widget[data-id="${CSS.escape(id)}"]`,
				)
			peer?.classList.toggle('is-dragging', on)
		}
		if (ids.length === 0) {
			el.classList.toggle('is-dragging', on)
		}
	}

	function cancelDrag() {
		if (!dragging) return
		const id = activeId
		const pid = pointerId
		setGroupDraggingVisual(false)
		dragging = false
		moved = false
		holdMenuOpened = false
		pointerId = null
		activeId = null
		clearLongPressTimer()
		removeWindowListeners()
		if (pid !== null) releaseCapture(pid)
		clearFolderHighlight()
		// Revert: style computed falls back to the persisted widget position.
		if (groupIds.length > 0) {
			clearGroupDragPositions()
		} else if (id) {
			delete dragPositions.value[id]
		}
	}

	function onPointerDown(event: PointerEvent) {
		if (!enabled || event.button !== 0 || dragging) return
		if (!(event.target instanceof Element)) return
		// Only handle pointers that land inside this widget (capture fires for subtree too,
		// but also when listening on ancestors — keep the guard explicit).
		if (!el.contains(event.target) && event.target !== el) return

		const ignoreFrom = options.ignoreFrom ?? '.resize-handle, .board-no-drag'
		if (matchesWithin(el, event.target, ignoreFrom)) return

		if (typeof options.allowFrom === 'string' && options.allowFrom.length > 0) {
			if (!matchesWithin(el, event.target, options.allowFrom)) return
		}

		const widget = toValue(options.widget)
		const index = toValue(options.index)
		activeId = widget.id
		dragging = true
		moved = false
		holdMenuOpened = false
		groupIds = []
		groupStarts = {}
		pointerId = event.pointerId
		pointerType = event.pointerType || 'mouse'
		dragThresholdPx = pointerType === 'mouse'
			? DRAG_THRESHOLD_MOUSE_PX
			: DRAG_THRESHOLD_TOUCH_PX
		lastClientX = event.clientX
		lastClientY = event.clientY

		if (!(activeId in dragPositions.value)) {
			dragPositions.value[activeId] = { ...board_position(widget, index) }
		}
		const start = dragPositions.value[activeId]
		rawX = start.x
		rawY = start.y

		addWindowListeners()

		const isTouch = pointerType !== 'mouse'
		if (isTouch) {
			// Capture immediately so a scrollable ancestor cannot pointercancel the
			// gesture before long-press fires. Tap is handled via onTap, not click.
			capturePointer(event.pointerId)
			clearLongPressTimer()
			longPressTimer = setTimeout(() => {
				longPressTimer = null
				if (!dragging || moved || holdMenuOpened) return
				openContextMenuAt(lastClientX, lastClientY)
			}, LONG_PRESS_MS)
		}
	}

	/** After the widget ContextMenuTrigger sees the event, block the ancestor pane menu. */
	function onPointerDownBubble(event: PointerEvent) {
		if (!enabled || event.pointerType === 'mouse') return
		if (!(event.target instanceof Element)) return
		if (!el.contains(event.target) && event.target !== el) return
		const ignoreFrom = options.ignoreFrom ?? '.resize-handle, .board-no-drag'
		if (matchesWithin(el, event.target, ignoreFrom)) return
		event.stopPropagation()
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId || !activeId) return

		if (holdMenuOpened) {
			event.stopImmediatePropagation()
			return
		}

		if (!moved) {
			const dx = event.clientX - lastClientX
			const dy = event.clientY - lastClientY
			const distance = Math.hypot(dx, dy)
			// Cancel long-press as soon as the finger meaningfully moves — otherwise a
			// slow drag still opens the menu ~700ms after pointerdown.
			if (distance >= LONG_PRESS_CANCEL_PX) {
				clearLongPressTimer()
			}
			if (distance < dragThresholdPx) {
				return
			}
			moved = true
			clearLongPressTimer()
			if (pointerType === 'mouse') capturePointer(event.pointerId)
			seedDragGroup(activeId)
			setGroupDraggingVisual(true)
		} else {
			event.preventDefault()
		}

		rawX += event.clientX - lastClientX
		rawY += event.clientY - lastClientY
		lastClientX = event.clientX
		lastClientY = event.clientY

		const primaryStart = groupStarts[activeId]
		if (!primaryStart || groupIds.length === 0) {
			const next = clampBoardPosition(snap_position({ x: rawX, y: rawY }, snap))
			dragPositions.value[activeId] = next
			applyVisualPosition(next)
		} else {
			// Snap + origin-clamp only the primary (same as single-drag). Companions
			// follow that exact delta so they never jump onto the grid / to (0,0)
			// at drag start.
			const primaryNext = clampBoardPosition(
				snap_position({ x: rawX, y: rawY }, snap),
			)
			const delta = {
				x: primaryNext.x - primaryStart.x,
				y: primaryNext.y - primaryStart.y,
			}
			const translated = applyGroupDragDelta(groupStarts, delta)
			const section = el.closest<HTMLElement>('section[data-path]')
			for (const memberId of groupIds) {
				const next = translated[memberId]!
				dragPositions.value[memberId] = next
				if (memberId === activeId) {
					applyVisualPosition(next)
					continue
				}
				const peer = section?.querySelector<HTMLElement>(
					`.board-widget[data-id="${CSS.escape(memberId)}"]`,
				)
				if (peer) {
					peer.style.left = `${next.x}px`
					peer.style.top = `${next.y}px`
				}
			}
		}

		// Multi-drag can still drop into a folder (primary hit-tests).
		const folder = findDropFolder(el)
		if (folder !== highlightedFolder) {
			clearFolderHighlight()
			highlightedFolder = folder
			folder?.classList.add('drop-target')
		}
	}

	async function finishDrag(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId || !activeId) return
		const id = activeId
		const didMove = moved
		const wasTouch = pointerType !== 'mouse'
		const openedMenu = holdMenuOpened
		const finishedGroupIds = [...groupIds]
		setGroupDraggingVisual(false)
		dragging = false
		pointerId = null
		activeId = null
		holdMenuOpened = false
		clearLongPressTimer()
		removeWindowListeners()
		releaseCapture(event.pointerId)
		clearFolderHighlight()

		if (!didMove) {
			delete dragPositions.value[id]
			groupIds = []
			groupStarts = {}
			// Tap selects; long-press already opened the menu — don't also toggle.
			if (wasTouch && !openedMenu) {
				options.onTap?.(event)
				blockGhostClick(el)
			} else if (wasTouch && openedMenu) {
				blockGhostClick(el)
			}
			return
		}

		blockGhostClick(el)
		blockGhostContextMenu(el)

		const widget = toValue(options.widget)
		const index = toValue(options.index)
		const idsToPersist = finishedGroupIds.length > 0 ? finishedGroupIds : [id]
		// Freeze seed offsets before awaits — live dragPositions can be cleared
		// or reused while tryDropOnFolder moves entries one by one.
		const memberStarts: Record<string, Position> = {}
		for (const memberId of idsToPersist) {
			const start = groupStarts[memberId] ?? dragPositions.value[memberId]
			if (start) memberStarts[memberId] = { ...start }
		}
		if (!memberStarts[id]) {
			memberStarts[id] = {
				...(dragPositions.value[id] ?? board_position(widget, index)),
			}
		}
		let cachedRelativeById: Record<string, Position> | null = null

		const dropOptions: FolderDropOptions = {
			getWorkspace: options.getWorkspace,
			resolveRelativePosition(_dragged, folder, widgetId) {
				if (!cachedRelativeById) {
					const folderLeft = parsePx(folder.style.left)
					const folderTop = parsePx(folder.style.top)
					const primaryLive = dragPositions.value[id] ?? {
						x: parsePx(el.style.left),
						y: parsePx(el.style.top),
					}
					cachedRelativeById = relativePositionsForFolderDrop(
						id,
						{
							x: primaryLive.x - folderLeft,
							y: primaryLive.y - folderTop,
						},
						memberStarts,
					)
				}
				return cachedRelativeById[widgetId] ?? null
			},
			onDropSuccess(droppedId) {
				delete dragPositions.value[droppedId]
			},
		}

		if (await tryDropOnFolder(el, idsToPersist, dropOptions)) {
			// Persist leftovers (e.g. drop target folder that was in the selection).
			const ws = options.getWorkspace()
			for (const leftoverId of idsToPersist) {
				const position = dragPositions.value[leftoverId]
				if (!position) continue
				await ws.change_position(leftoverId, position)
				if (activeId === leftoverId) continue
				delete dragPositions.value[leftoverId]
			}
			if (activeId === null) {
				groupIds = []
				groupStarts = {}
			}
			return
		}

	const ws = options.getWorkspace()
	// Snapshot before awaits — live dragPositions may be reused by a new gesture.
		const snapshots = idsToPersist.map((persistId) => {
			const position = dragPositions.value[persistId]
				?? (persistId === id ? board_position(widget, index) : null)
			return position ? { id: persistId, position: { ...position } } : null
		}).filter((entry): entry is { id: string; position: Position } => entry !== null)

		for (const { id: persistId, position } of snapshots) {
			await ws.change_position(persistId, position)
		}
		await nextTick()
		// A new gesture may own an entry by now — let it finish and clean up.
		for (const { id: persistId } of snapshots) {
			if (activeId === persistId) continue
			if (activeId !== null && groupIds.includes(persistId)) continue
			delete dragPositions.value[persistId]
		}
		if (activeId === null) {
			groupIds = []
			groupStarts = {}
		}
	}

	function onPointerUp(event: PointerEvent) {
		void finishDrag(event)
	}

	function onPointerCancel(event: PointerEvent) {
		if (event.pointerId !== pointerId) return
		cancelDrag()
	}

	function onWindowBlur() {
		cancelDrag()
	}

	function onLostPointerCapture() {
		// Losing capture is fine (window listeners keep tracking) unless the
		// node was detached mid-drag — then the gesture cannot continue.
		if (!el.isConnected) cancelDrag()
	}

	el.addEventListener('pointerdown', onPointerDown, listenerOpts)
	el.addEventListener('pointerdown', onPointerDownBubble, bubbleOpts)
	el.addEventListener('lostpointercapture', onLostPointerCapture)

	controllers.set(el, {
		setEnabled(next) {
			enabled = next
			if (!next) cancelDrag()
		},
		setSnap(next) {
			snap = next
		},
		destroy() {
			cancelDrag()
			el.removeEventListener('pointerdown', onPointerDown, listenerOpts)
			el.removeEventListener('pointerdown', onPointerDownBubble, bubbleOpts)
			el.removeEventListener('lostpointercapture', onLostPointerCapture)
			controllers.delete(el)
		},
	})
}

export function updateBoardDragSnap(el: HTMLElement, snap: BoardSnap) {
	controllers.get(el)?.setSnap(snap)
}

export function setBoardDragEnabled(el: HTMLElement, enabled: boolean) {
	controllers.get(el)?.setEnabled(enabled)
}

export function unbindBoardDrag(el: HTMLElement) {
	controllers.get(el)?.destroy()
}

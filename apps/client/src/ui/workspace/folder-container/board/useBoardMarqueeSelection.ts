import { computed, ref, toValue, type MaybeRefOrGetter, type Ref } from 'vue'
import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import { board_position, board_size } from '@/services/board/layout'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { marqueeHitsBounds, normalizeRect, type MarqueeRect } from './marqueeGeometry'
import { isEmptyBoardPointerTarget } from './isEmptyBoardPointerTarget'

const DRAG_THRESHOLD_PX = 4

type UseBoardMarqueeSelectionOptions = {
	boardRef: Ref<HTMLElement | null>
	children: MaybeRefOrGetter<FolderContainerWidgetChild[]>
	dragPositions: Ref<Record<string, Position>>
	dragSizes: Ref<Record<string, Size>>
	/** When set, marquee is disabled (shape placement mode). */
	placementActive: MaybeRefOrGetter<boolean>
}

function sameIds(a: string[], b: string[]): boolean {
	if (a.length !== b.length) return false
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) return false
	}
	return true
}

export function useBoardMarqueeSelection(options: UseBoardMarqueeSelectionOptions) {
	const requireWorkspace = useRequireWorkspace()
	const marquee = ref<MarqueeRect | null>(null)
	const suppressNextPaneClick = ref(false)

	let pointerId: number | null = null
	let startX = 0
	let startY = 0
	let active = false
	let dragCommitted = false
	let lastLiveIds: string[] = []

	function boardPointFromEvent(event: PointerEvent): { x: number; y: number } | null {
		const section = options.boardRef.value
		if (!section) return null
		const rect = section.getBoundingClientRect()
		return {
			x: event.clientX - rect.left + section.scrollLeft,
			y: event.clientY - rect.top + section.scrollTop,
		}
	}

	function isEmptyBoardTarget(target: EventTarget | null): boolean {
		return isEmptyBoardPointerTarget(target, options.boardRef.value)
	}

	function findIntersectingIds(rect: MarqueeRect): string[] {
		const children = toValue(options.children)
		const ids: string[] = []
		for (let index = 0; index < children.length; index++) {
			const widget = children[index]!
			const position = options.dragPositions.value[widget.id]
				?? board_position(widget, index)
			const size = options.dragSizes.value[widget.id]
				?? board_size(widget)
			if (marqueeHitsBounds(rect, { ...position, ...size })) {
				ids.push(widget.id)
			}
		}
		return ids
	}

	/** Live-update workspace selection while the marquee is drawn (Canvas-like). */
	function applyLiveSelection(rect: MarqueeRect) {
		const ids = findIntersectingIds(rect)
		if (sameIds(ids, lastLiveIds)) return
		lastLiveIds = ids
		requireWorkspace().set_selection(ids)
	}

	function onPointerDown(event: PointerEvent) {
		if (event.button !== 0) return
		// Touch drag on empty board is reserved for scrolling (overflow: auto).
		if (event.pointerType === 'touch') return
		if (toValue(options.placementActive)) return
		if (!isEmptyBoardTarget(event.target)) return

		const point = boardPointFromEvent(event)
		if (!point) return

		pointerId = event.pointerId
		startX = point.x
		startY = point.y
		active = true
		dragCommitted = false
		lastLiveIds = []
		marquee.value = normalizeRect(startX, startY, startX, startY)

		const section = options.boardRef.value
		section?.setPointerCapture(event.pointerId)
	}

	function onPointerMove(event: PointerEvent) {
		if (!active || event.pointerId !== pointerId) return
		const point = boardPointFromEvent(event)
		if (!point) return

		const rect = normalizeRect(startX, startY, point.x, point.y)
		marquee.value = rect

		const dragged =
			rect.width >= DRAG_THRESHOLD_PX || rect.height >= DRAG_THRESHOLD_PX
		if (!dragged) return

		if (!dragCommitted) {
			dragCommitted = true
			suppressNextPaneClick.value = true
			// Marquee can create a native text selection; clear it.
			window.getSelection()?.removeAllRanges()
		}
		applyLiveSelection(rect)
	}

	function finish(event: PointerEvent) {
		if (!active || event.pointerId !== pointerId) return
		active = false
		pointerId = null

		const rect = marquee.value
		marquee.value = null

		if (!rect) return

		const dragged =
			rect.width >= DRAG_THRESHOLD_PX || rect.height >= DRAG_THRESHOLD_PX

		if (!dragged) {
			// Empty-board tap. After setPointerCapture, mobile WebViews often
			// skip the synthetic click that would clear selection / exit Select
			// mode — do it here.
			requireWorkspace().exit_selection_mode()
			suppressNextPaneClick.value = true
			window.setTimeout(() => {
				suppressNextPaneClick.value = false
			}, 0)
			dragCommitted = false
			lastLiveIds = []
			return
		}

		suppressNextPaneClick.value = true
		// Final sync (in case last move was skipped).
		applyLiveSelection(rect)
		dragCommitted = false
		lastLiveIds = []
		window.setTimeout(() => {
			suppressNextPaneClick.value = false
		}, 0)
	}

	function onPointerUp(event: PointerEvent) {
		finish(event)
	}

	function onPointerCancel(event: PointerEvent) {
		if (!active || event.pointerId !== pointerId) return
		active = false
		pointerId = null
		dragCommitted = false
		lastLiveIds = []
		marquee.value = null
	}

	/** Call from pane click handler before shared clear-selection logic. */
	function consumeSuppressedPaneClick(): boolean {
		if (!suppressNextPaneClick.value) return false
		suppressNextPaneClick.value = false
		return true
	}

	const marqueeStyle = computed(() => {
		const rect = marquee.value
		if (!rect) return null
		return {
			left: `${rect.x}px`,
			top: `${rect.y}px`,
			width: `${rect.width}px`,
			height: `${rect.height}px`,
		}
	})

	return {
		marquee,
		marqueeStyle,
		onPointerDown,
		onPointerMove,
		onPointerUp,
		onPointerCancel,
		consumeSuppressedPaneClick,
	}
}

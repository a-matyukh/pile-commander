import {
	onMounted,
	onUnmounted,
	toValue,
	type MaybeRefOrGetter,
	type Ref,
} from 'vue'
import type { FolderContainerWidgetChild, Position } from '@/domain/Widget'
import {
	board_position,
	DEFAULT_GRID_SIZE,
	type BoardSnapSettings,
} from '@/services/board/layout'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { clampBoardPosition } from './board/boardDragBinding'

type UseMoveSelectedWidgetsOptions = {
	children: MaybeRefOrGetter<FolderContainerWidgetChild[]>
	editingNoteId: Ref<string | null>
	boardSnapSettings: MaybeRefOrGetter<BoardSnapSettings>
	/** When false, keyboard handler is inactive (e.g. embedded folder previews). */
	enabled?: MaybeRefOrGetter<boolean>
}

const ARROW_DELTAS: Record<string, Position> = {
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

/**
 * Next positions for the selected children moved by (dx, dy) * step.
 * Widgets without a position xattr start from their board fallback slot;
 * results are clamped to the non-negative board quadrant.
 */
export function compute_nudge_positions(
	children: FolderContainerWidgetChild[],
	selectedIds: readonly string[],
	delta: Position,
	step: number,
): Array<{ id: string; position: Position }> {
	const selected = new Set(selectedIds)
	const moves: Array<{ id: string; position: Position }> = []

	for (let index = 0; index < children.length; index++) {
		const widget = children[index]
		if (!selected.has(widget.id)) continue

		const current = board_position(widget, index)
		const next = clampBoardPosition({
			x: current.x + delta.x * step,
			y: current.y + delta.y * step,
		})
		if (next.x === current.x && next.y === current.y) continue
		moves.push({ id: widget.id, position: next })
	}

	return moves
}

/**
 * Arrow keys nudge selected widgets by 1px; Shift+arrow by grid_size
 * (DEFAULT_GRID_SIZE when unset). Mounted per board/canvas view.
 */
export function useMoveSelectedWidgets(options: UseMoveSelectedWidgetsOptions) {
	const ws = useRequireWorkspace()()

	function nudgeStep(event: KeyboardEvent): number {
		if (!event.shiftKey) return 1
		const gridSize = toValue(options.boardSnapSettings).grid_size
		return gridSize > 0 ? gridSize : DEFAULT_GRID_SIZE
	}

	function onKeyDown(event: KeyboardEvent) {
		const delta = ARROW_DELTAS[event.key]
		if (!delta) return
		if (event.defaultPrevented) return
		if (event.metaKey || event.ctrlKey || event.altKey) return
		if (isTypingTarget(event.target)) return
		if (toValue(options.enabled) === false) return
		if (!ws.can_write) return
		if (options.editingNoteId.value) return

		const children = toValue(options.children)
		const moves = compute_nudge_positions(
			children,
			ws.selection,
			delta,
			nudgeStep(event),
		)
		if (moves.length === 0) return

		// Capture-phase stop: preempts Vue Flow's own arrow-key node a11y move.
		event.preventDefault()
		event.stopPropagation()

		void (async () => {
			for (const move of moves) {
				await ws.change_position(move.id, move.position)
			}
		})()
	}

	onMounted(() => {
		// Capture: Vue Flow moves focused selected nodes on arrow keydown —
		// intercept first or the widget shifts twice.
		window.addEventListener('keydown', onKeyDown, true)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown, true)
	})
}

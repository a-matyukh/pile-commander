import { computed, inject, onMounted, onUnmounted, ref, type ComputedRef, type Ref } from 'vue'
import type { Position } from '@/domain/Widget'
import {
	SHAPE_LINE_DEFAULT_SIZE,
	snap_position,
	type BoardSnap,
} from '@/services/board/layout'
import { constrain_line_angle } from '@/services/board/shapes'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { boardSnapSettingsKey } from './injectKeys'
import { useBoardPlacement } from './board/boardShapePlacement'
import { blockGhostClick } from './board/blockGhostClick'

export type LineDrawKind = 'plain' | 'arrow'

const DRAG_THRESHOLD_PX = 4

function cursorSvg(kind: LineDrawKind): string {
	const head = kind === 'arrow'
		? '<path d="M22.5 1.5l-8 2L17 9.5z" fill="#111827" stroke="#ffffff" stroke-width="1"/>'
		: ''
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">`
		+ '<line x1="3" y1="21" x2="21" y2="3" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>'
		+ '<line x1="3" y1="21" x2="21" y2="3" stroke="#111827" stroke-width="2" stroke-linecap="round"/>'
		+ head
		+ '</svg>'
	return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}") 3 21, crosshair`
}

export const LINE_DRAW_CURSORS: Record<LineDrawKind, string> = {
	plain: cursorSvg('plain'),
	arrow: cursorSvg('arrow'),
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

type UseLineDrawModeOptions = {
	folderId: ComputedRef<string>
	/** Embedded folder previews ignore the hotkeys and gestures. */
	isEmbedded: boolean
	/** Maps a pointer event to pane coordinates (board scroll offset / flow projection). */
	resolvePoint: (event: { clientX: number; clientY: number }) => Position | null
	/** Only presses on empty pane start a line; widget hits keep normal behavior. */
	isEmptyTarget: (target: EventTarget | null) => boolean
	/** When false, L does not arm a plain line (canvas uses L for lasso). Default true. */
	plainLineHotkey?: boolean
}

/**
 * One-shot line drawing armed by keyboard: L = plain line (board only; canvas
 * uses L for lasso), A = arrow-ended. While armed the next pointer drag on
 * empty pane sketches a line; releasing creates the widget and disarms. A
 * click without drag drops a default-size line. Escape or re-pressing the
 * hotkey cancels.
 */
export function useLineDrawMode(options: UseLineDrawModeOptions) {
	const { clearBoardPlacement } = useBoardPlacement()
	const boardSnapSettings = inject(boardSnapSettingsKey, null)
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()

	const armed = ref<LineDrawKind | null>(null)
	const preview = ref<{ start: Position; end: Position } | null>(null)

	let dragging = false
	let pointerId: number | null = null
	let start: Position = { x: 0, y: 0 }
	let end: Position = { x: 0, y: 0 }
	let captureEl: HTMLElement | null = null

	const cursor = computed(() =>
		armed.value ? LINE_DRAW_CURSORS[armed.value] : undefined,
	)

	function snap(): BoardSnap {
		return {
			enabled: boardSnapSettings?.value.snap_to_grid ?? false,
			size: boardSnapSettings?.value.grid_size ?? 20,
		}
	}

	function arm(kind: LineDrawKind) {
		armed.value = kind
		clearBoardPlacement()
	}

	function disarm() {
		armed.value = null
		cancelDrag()
	}

	function toggle(kind: LineDrawKind) {
		if (armed.value === kind) disarm()
		else arm(kind)
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented) return
		if (event.repeat) return
		if (isTypingTarget(event.target)) return
		if (event.metaKey || event.ctrlKey || event.altKey) return

		const key = event.key.toLowerCase()
		if (key === 'escape') {
			if (armed.value) {
				event.preventDefault()
				disarm()
			}
			return
		}
		if (key === 'l' || key === 'a') {
			if (workspace.value?.can_write === false) return
		}
		if (key === 'l') {
			if (options.plainLineHotkey === false) return
			toggle('plain')
		}
		else if (key === 'a') toggle('arrow')
		else return
		event.preventDefault()
	}

	function cancelDrag() {
		if (!dragging) return
		dragging = false
		pointerId = null
		preview.value = null
		captureEl = null
		window.removeEventListener('pointermove', onPointerMove, true)
		window.removeEventListener('pointerup', onPointerUp, true)
		window.removeEventListener('pointercancel', onPointerCancel, true)
	}

	function onPointerDown(event: PointerEvent) {
		if (!armed.value) return
		if (event.button !== 0) return
		// Touch drag on empty pane stays reserved for scrolling/panning.
		if (event.pointerType === 'touch') return
		if (!options.isEmptyTarget(event.target)) return

		const point = options.resolvePoint(event)
		if (!point) return

		event.preventDefault()
		event.stopPropagation()

		dragging = true
		pointerId = event.pointerId
		start = snap_position(point, snap())
		end = { ...start }
		preview.value = { start: { ...start }, end: { ...end } }

		const el = (event.currentTarget instanceof HTMLElement
			? event.currentTarget
			: event.target instanceof HTMLElement
				? event.target
				: null)
		if (el) {
			captureEl = el
			try {
				el.setPointerCapture(event.pointerId)
			} catch {
				// Some environments reject capture; window listeners still work.
			}
		}

		window.addEventListener('pointermove', onPointerMove, true)
		window.addEventListener('pointerup', onPointerUp, true)
		window.addEventListener('pointercancel', onPointerCancel, true)
	}

	function onPointerMove(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return
		event.preventDefault()
		event.stopPropagation()

		const point = options.resolvePoint(event)
		if (!point) return
		const snapped = snap_position(point, snap())
		// Shift constrains the line to strict 0°/45°/90° directions.
		end = event.shiftKey ? constrain_line_angle(start, snapped) : snapped
		preview.value = { start: { ...start }, end: { ...end } }
	}

	async function finish() {
		const kind = armed.value
		disarm()
		// The synthetic click after pointerup would hit empty pane and clear
		// selection / exit note editing — swallow it like widget drags do.
		blockGhostClick()
		if (!kind) return

		const dragged =
			Math.abs(end.x - start.x) >= DRAG_THRESHOLD_PX
			|| Math.abs(end.y - start.y) >= DRAG_THRESHOLD_PX
		const lineEnd = dragged
			? end
			: { x: start.x + SHAPE_LINE_DEFAULT_SIZE.width, y: start.y }

		await requireWorkspace().create_line(
			options.folderId.value,
			start,
			lineEnd,
			kind === 'arrow' ? 'arrow' : 'none',
		)
	}

	function onPointerUp(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return
		event.preventDefault()
		event.stopPropagation()
		void finish()
	}

	function onPointerCancel(event: PointerEvent) {
		if (!dragging || event.pointerId !== pointerId) return
		event.preventDefault()
		event.stopPropagation()
		disarm()
	}

	const listenerOpts: AddEventListenerOptions = { capture: true }
	let boundEl: HTMLElement | null = null

	/**
	 * Attach the capture-phase pointerdown listener. Capture on the wrapper
	 * guarantees we intercept before marquee / Vue Flow pan handlers.
	 */
	function bind(el: HTMLElement | null) {
		if (boundEl) boundEl.removeEventListener('pointerdown', onPointerDown, listenerOpts)
		boundEl = el
		if (el) el.addEventListener('pointerdown', onPointerDown, listenerOpts)
	}

	onMounted(() => {
		if (options.isEmbedded) return
		window.addEventListener('keydown', onKeyDown)
	})

	onUnmounted(() => {
		bind(null)
		cancelDrag()
		window.removeEventListener('keydown', onKeyDown)
	})

	return {
		armed,
		preview,
		cursor,
		disarm,
		bind,
	}
}

import { inject, toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import {
	absolute_line_endpoints,
	build_line_svg,
	constrain_line_angle,
	line_layout_from_endpoints,
	prepare_svg_for_preview,
	type LineAxis,
	type LineShapeMeta,
} from '@/services/board/shapes'
import { snap_position, type BoardSnap } from '@/services/board/layout'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { boardDragStateKey, boardSnapSettingsKey } from '../injectKeys'
import { blockGhostClick } from '../board/blockGhostClick'

export type LineEndpointWhich = 'start' | 'end'

export type LineEndpointLiveLayout = {
	position: Position
	size: Size
	flipX: boolean
	flipY: boolean
	axis: LineAxis
}

type UseLineEndpointDragOptions = {
	widget: MaybeRefOrGetter<FolderContainerWidgetChild>
	/** Current line meta (must be non-null while dragging). */
	meta: MaybeRefOrGetter<LineShapeMeta | null>
	/** Board uses local drag state; canvas supplies zoom + live node updates. */
	mode: 'board' | 'canvas'
	getZoom?: () => number
	/** Canvas: read live node position/size (Vue Flow), not stale widget xattrs. */
	getCanvasPosition?: () => Position
	getCanvasSize?: () => Size
	/** Canvas: update Vue Flow node position/size while dragging. */
	applyCanvasLive?: (layout: LineEndpointLiveLayout) => void
}

function boardSnapFromSettings(
	settings: { snap_to_grid: boolean; grid_size: number } | null | undefined,
): BoardSnap {
	return {
		enabled: settings?.snap_to_grid ?? false,
		size: settings?.grid_size ?? 20,
	}
}

/**
 * FigJam-style endpoint drag for line/arrow shapes.
 * Accumulates raw absolute coords, snaps, then recomputes AABB + flips.
 */
export function useLineEndpointDrag(options: UseLineEndpointDragOptions) {
	const dragState = inject(boardDragStateKey, null)
	const boardSnapSettings = inject(boardSnapSettingsKey, null)
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()

	let active: LineEndpointWhich | null = null
	let rawX = 0
	let rawY = 0
	let lastClientX = 0
	let lastClientY = 0
	let fixedEndpoint: Position = { x: 0, y: 0 }
	let dragMeta: LineShapeMeta | null = null
	let liveLayout: LineEndpointLiveLayout | null = null
	let snap: BoardSnap = { enabled: false, size: 20 }
	let pointerId: number | null = null

	function seedLayout(meta: LineShapeMeta): LineEndpointLiveLayout {
		const widget = toValue(options.widget)
		if (options.mode === 'board' && dragState) {
			const pos = dragState.dragPositions.value[widget.id]
				?? widget.position
				?? { x: 0, y: 0 }
			const size = dragState.dragSizes.value[widget.id]
				?? widget.size
				?? { width: meta.width, height: meta.height }
			return {
				position: { ...pos },
				size: { ...size },
				flipX: meta.flipX,
				flipY: meta.flipY,
				axis: meta.axis,
			}
		}

		return {
			position: {
				...(options.getCanvasPosition?.()
					?? widget.position
					?? { x: 0, y: 0 }),
			},
			size: {
				...(options.getCanvasSize?.()
					?? widget.size
					?? { width: meta.width, height: meta.height }),
			},
			flipX: meta.flipX,
			flipY: meta.flipY,
			axis: meta.axis,
		}
	}

	function applyLive(layout: LineEndpointLiveLayout, meta: LineShapeMeta) {
		liveLayout = layout
		const widget = toValue(options.widget)
		const nextMeta: LineShapeMeta = {
			...meta,
			width: layout.size.width,
			height: layout.size.height,
			flipX: layout.flipX,
			flipY: layout.flipY,
			axis: layout.axis,
		}
		const svg = build_line_svg(nextMeta)
		requireWorkspace().content_caches.shapes.set(widget.id, prepare_svg_for_preview(svg))

		if (options.mode === 'board' && dragState) {
			dragState.dragPositions.value[widget.id] = { ...layout.position }
			dragState.dragSizes.value[widget.id] = { ...layout.size }
			return
		}

		options.applyCanvasLive?.(layout)
	}

	function onPointerMove(event: PointerEvent) {
		if (active === null || !dragMeta || event.pointerId !== pointerId) return

		const zoom = options.getZoom?.() ?? 1
		rawX += (event.clientX - lastClientX) / zoom
		rawY += (event.clientY - lastClientY) / zoom
		lastClientX = event.clientX
		lastClientY = event.clientY

		const snapped = snap_position({ x: rawX, y: rawY }, snap)
		// Shift constrains the line to strict 0°/45°/90° directions.
		const moved = event.shiftKey
			? constrain_line_angle(fixedEndpoint, snapped)
			: snapped
		const start = active === 'start' ? moved : fixedEndpoint
		const end = active === 'end' ? moved : fixedEndpoint
		// prevAxis hysteresis prevents h/d flip-flop; anchor pins the fixed
		// endpoint (incl. min-extent padding) so it never shifts while dragging.
		const layout = line_layout_from_endpoints(start, end, liveLayout?.axis, {
			point: fixedEndpoint,
			which: active === 'start' ? 'end' : 'start',
		})
		applyLive(layout, dragMeta)
	}

	async function onPointerUp(event: PointerEvent) {
		if (event.pointerId !== pointerId) return
		const meta = dragMeta
		const layout = liveLayout
		active = null
		pointerId = null
		dragMeta = null
		liveLayout = null

		window.removeEventListener('pointermove', onPointerMove)
		window.removeEventListener('pointerup', onPointerUp)
		window.removeEventListener('pointercancel', onPointerUp)

		// Endpoint may leave the widget under the cursor; the following synthetic
		// click would hit empty pane and clear selection — same as widget drag.
		blockGhostClick()

		if (!meta || !layout) return

		const widget = toValue(options.widget)
		const ws = requireWorkspace()
		await ws.change_line_geometry(widget.id, {
			position: layout.position,
			size: layout.size,
			flipX: layout.flipX,
			flipY: layout.flipY,
			axis: layout.axis,
			startPlug: meta.startPlug,
			endPlug: meta.endPlug,
		})

		// Keep the line selected so endpoint handles stay available until the
		// user explicitly clicks empty space.
		ws.select(widget.id)

		if (options.mode === 'board' && dragState) {
			delete dragState.dragPositions.value[widget.id]
			delete dragState.dragSizes.value[widget.id]
		}
	}

	function onPointerDown(which: LineEndpointWhich, event: PointerEvent) {
		if (workspace.value?.can_write === false) return
		const meta = toValue(options.meta)
		if (!meta) return

		event.preventDefault()
		event.stopPropagation()

		const layout = seedLayout(meta)
		const { start, end } = absolute_line_endpoints(
			layout.position,
			layout.size,
			layout.flipX,
			layout.flipY,
			layout.axis,
		)

		active = which
		dragMeta = meta
		liveLayout = layout
		pointerId = event.pointerId
		fixedEndpoint = which === 'start' ? { ...end } : { ...start }
		const seed = which === 'start' ? start : end
		rawX = seed.x
		rawY = seed.y
		lastClientX = event.clientX
		lastClientY = event.clientY
		snap = boardSnapFromSettings(boardSnapSettings?.value)

		const target = event.currentTarget
		if (target instanceof HTMLElement) {
			try {
				target.setPointerCapture(event.pointerId)
			} catch {
				// Some environments reject capture; window listeners still work.
			}
		}

		// Ensure selection while editing endpoints (handles only render when selected).
		requireWorkspace().select(toValue(options.widget).id)

		window.addEventListener('pointermove', onPointerMove)
		window.addEventListener('pointerup', onPointerUp)
		window.addEventListener('pointercancel', onPointerUp)
	}

	function updateSnapFromSettings() {
		snap = boardSnapFromSettings(boardSnapSettings?.value)
	}

	return {
		onPointerDown,
		updateSnapFromSettings,
	}
}

/** Handle corner / mid-side style from current flips + axis. */
export function line_handle_style(
	which: LineEndpointWhich,
	flipX: boolean,
	flipY: boolean,
	axis: LineAxis = 'd',
): Record<string, string> {
	const isStart = which === 'start'
	if (axis === 'h') {
		const atRight = isStart ? flipX : !flipX
		return {
			left: `${atRight ? 100 : 0}%`,
			top: '50%',
		}
	}
	if (axis === 'v') {
		const atBottom = isStart ? flipY : !flipY
		return {
			left: '50%',
			top: `${atBottom ? 100 : 0}%`,
		}
	}
	const startLeft = flipX
	const startTop = flipY
	return {
		left: `${(isStart ? startLeft : !startLeft) ? 100 : 0}%`,
		top: `${(isStart ? startTop : !startTop) ? 100 : 0}%`,
	}
}

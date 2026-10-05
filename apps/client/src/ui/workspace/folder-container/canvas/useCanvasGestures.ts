import type { ComputedRef, Ref } from 'vue'
import { board_size } from '@/services/board/layout'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import { useCanvasDrawing } from './drawing/useCanvasDrawing'
import { useLassoSelection, type LassoHits } from './drawing/useLassoSelection'
import { findStrokesInPolygon } from './drawing/lassoGeometry'
import {
	findEdgesInPolygon,
	findWidgetsInPolygon,
	type EdgeLayout,
	type WidgetLayout,
} from './drawing/selectionGeometry'
import { usePinchZoom } from './drawing/usePinchZoom'
import { usePointerCanvas } from './drawing/usePointerCanvas'
import type { BoardViewport, EditorTool, Point } from './drawing/types'
import type { CanvasFlowNode } from './useCanvasNodes'
import type { FlowEdgeLike } from './useCanvasFlow'

type UseCanvasGesturesOptions = {
	strokeNodes: Ref<FlowStrokeNode[]>
	widgetNodes: Ref<CanvasFlowNode[]>
	edges: Ref<FlowEdgeLike[]>
	tool: Ref<EditorTool>
	penColor: Ref<string>
	penWidth: Ref<number>
	applyStrokeSelection: (selectedIds: Set<string>) => boolean
	applyWidgetSelection: (selectedIds: Set<string>) => boolean
	applyEdgeSelection: (selectedIds: Set<string>) => boolean
	flowWrapper: Ref<HTMLElement | null>
	paneEl: Ref<HTMLElement | null>
	pinchEnabled: ComputedRef<boolean>
	getViewport: () => BoardViewport
	setViewport: (viewport: BoardViewport) => void
	screenToFlow: (clientX: number, clientY: number) => Point
	/** z for the next committed stroke; persist hook after a pen commit. */
	nextStrokeZ?: () => number
	onStrokeCommit?: (node: FlowStrokeNode) => void
}

function widgetLayouts(nodes: CanvasFlowNode[]): WidgetLayout[] {
	return nodes.map((node) => {
		const size = board_size(node.data.widget)
		return {
			id: node.id,
			position: node.position,
			width: size.width,
			height: size.height,
		}
	})
}

function edgeLayouts(edges: FlowEdgeLike[]): EdgeLayout[] {
	return edges.map(edge => ({
		id: edge.id,
		source: edge.source,
		target: edge.target,
		sourceHandle: typeof edge.sourceHandle === 'string' ? edge.sourceHandle : null,
		targetHandle: typeof edge.targetHandle === 'string' ? edge.targetHandle : null,
	}))
}

/**
 * Wires the drawing gestures together: pen strokes, lasso selection,
 * pointer capture on the flow pane, and pinch-to-zoom.
 */
export function useCanvasGestures(options: UseCanvasGesturesOptions) {
	const { tool } = options

	const {
		previewPath,
		previewPointCount,
		startStroke,
		extendStroke,
		commitStroke,
		cancelStroke,
		removeStrokeNode,
	} = useCanvasDrawing(options.strokeNodes, options.penColor, options.penWidth, tool, {
		nextZ: options.nextStrokeZ,
		onCommit: options.onStrokeCommit,
	})

	function collectLassoHits(polygon: Point[]): LassoHits {
		const widgets = widgetLayouts(options.widgetNodes.value)
		return {
			strokeIds: findStrokesInPolygon(options.strokeNodes.value, polygon),
			widgetIds: findWidgetsInPolygon(widgets, polygon),
			edgeIds: findEdgesInPolygon(edgeLayouts(options.edges.value), widgets, polygon),
		}
	}

	function applyLassoSelection(hits: LassoHits): boolean {
		const strokes = options.applyStrokeSelection(hits.strokeIds)
		const widgets = options.applyWidgetSelection(hits.widgetIds)
		const edges = options.applyEdgeSelection(hits.edgeIds)
		return strokes || widgets || edges
	}

	const {
		lassoPath,
		startLasso,
		extendLasso,
		commitLasso,
		cancelLasso,
	} = useLassoSelection(tool, collectLassoHits, applyLassoSelection)

	const { isPinching, bind: bindPinch } = usePinchZoom({
		targetEl: options.flowWrapper,
		getViewport: options.getViewport,
		setViewport: options.setViewport,
		enabled: options.pinchEnabled,
		onGestureStart: () => {
			if (tool.value === 'pen') commitStroke()
			else cancelStroke()
			cancelLasso()
		},
	})

	function onDrawStart(point: Point) {
		if (tool.value === 'pen') startStroke(point)
		else if (tool.value === 'lasso') startLasso(point)
	}

	function onDrawExtend(point: Point) {
		if (tool.value === 'pen') extendStroke(point)
		else if (tool.value === 'lasso') extendLasso(point)
	}

	function onDrawEnd() {
		if (tool.value === 'pen') commitStroke()
		else if (tool.value === 'lasso') commitLasso()
	}

	function onDrawCancel() {
		if (tool.value === 'pen') cancelStroke()
		else cancelLasso()
	}

	const { bindPane } = usePointerCanvas({
		tool,
		isPinching,
		paneEl: options.paneEl,
		screenToFlow: options.screenToFlow,
		onStrokeStart: onDrawStart,
		onStrokeExtend: onDrawExtend,
		onStrokeEnd: onDrawEnd,
		onStrokeCancel: onDrawCancel,
	})

	return {
		previewPath,
		previewPointCount,
		lassoPath,
		removeStrokeNode,
		cancelLasso,
		bindPane,
		bindPinch,
	}
}

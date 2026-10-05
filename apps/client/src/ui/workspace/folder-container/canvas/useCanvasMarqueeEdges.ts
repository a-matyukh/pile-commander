import { watch, type ComputedRef, type Ref } from 'vue'
import { board_size } from '@/services/board/layout'
import {
	findEdgesInRect,
	paneRectToFlow,
	type EdgeLayout,
	type WidgetLayout,
} from './drawing/selectionGeometry'
import type { CanvasFlowNode } from './useCanvasNodes'
import type { FlowEdgeLike } from './useCanvasFlow'
import type { BoardViewport } from './drawing/types'

type SelectionRectLike = {
	x: number
	y: number
	width: number
	height: number
} | null

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
 * Vue Flow's box select marks edges connected to selected nodes.
 * Overlay path-vs-rect hits so a marquee over a connection curve selects it.
 */
export function useCanvasMarqueeEdges(options: {
	isSelectTool: ComputedRef<boolean>
	widgetNodes: Ref<CanvasFlowNode[]>
	edges: Ref<FlowEdgeLike[]>
	userSelectionRect: Ref<SelectionRectLike>
	viewport: ComputedRef<BoardViewport>
	applyEdgeSelection: (selectedIds: Set<string>) => boolean
}) {
	watch(
		() => options.userSelectionRect.value,
		(rect) => {
			if (!options.isSelectTool.value || !rect) return
			if (rect.width <= 0 && rect.height <= 0) return
			const flowRect = paneRectToFlow(rect, options.viewport.value)
			const hits = findEdgesInRect(
				edgeLayouts(options.edges.value),
				widgetLayouts(options.widgetNodes.value),
				flowRect,
			)
			options.applyEdgeSelection(hits)
		},
		{ deep: true },
	)
}

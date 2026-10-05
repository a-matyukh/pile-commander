import { ref, type Ref } from 'vue'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import { createId } from './createId'
import { buildFlowStrokeNode, pointsToPath } from './strokePath'
import type { EditorTool, Point } from './types'

export function useCanvasDrawing(
	nodes: Ref<FlowStrokeNode[]>,
	penColor: Ref<string>,
	penWidth: Ref<number>,
	tool: Ref<EditorTool>,
	options?: {
		/** z for the next committed stroke (max of current + 1). */
		nextZ?: () => number
		/** Called after a stroke node is appended — persist hook. */
		onCommit?: (node: FlowStrokeNode) => void
	},
) {
	// Hot path: points and the SVG path string are plain (non-reactive) values,
	// appended in place on each pointermove; the reactive preview refs are
	// updated at most once per animation frame.
	let activePoints: Point[] = []
	let pathString = ''
	let pendingFrame: number | null = null

	const previewPath = ref('')
	const previewPointCount = ref(0)
	const isDrawing = ref(false)

	function flushPreview() {
		pendingFrame = null
		previewPath.value = activePoints.length === 1
			? pointsToPath(activePoints, penWidth.value)
			: pathString
		previewPointCount.value = activePoints.length
	}

	function schedulePreview() {
		if (pendingFrame !== null) return
		pendingFrame = requestAnimationFrame(flushPreview)
	}

	function clearPreview() {
		if (pendingFrame !== null) {
			cancelAnimationFrame(pendingFrame)
			pendingFrame = null
		}
		previewPath.value = ''
		previewPointCount.value = 0
	}

	function startStroke(flowPoint: Point) {
		if (tool.value !== 'pen') return
		isDrawing.value = true
		activePoints = [flowPoint]
		pathString = `M ${flowPoint.x} ${flowPoint.y}`
		flushPreview()
	}

	function extendStroke(flowPoint: Point) {
		if (tool.value !== 'pen' || !isDrawing.value) return
		const last = activePoints[activePoints.length - 1]
		if (last && last.x === flowPoint.x && last.y === flowPoint.y) return
		activePoints.push(flowPoint)
		pathString += ` L ${flowPoint.x} ${flowPoint.y}`
		schedulePreview()
	}

	function commitStroke() {
		if (tool.value !== 'pen' || !isDrawing.value) {
			cancelStroke()
			return
		}

		const points = activePoints
		isDrawing.value = false
		activePoints = []
		pathString = ''

		try {
			const built = buildFlowStrokeNode(
				createId(),
				points,
				penColor.value,
				penWidth.value,
				options?.nextZ?.() ?? 1,
			)
			if (built) {
				nodes.value = [...nodes.value, built]
				options?.onCommit?.(built)
			}
		} finally {
			clearPreview()
		}
	}

	function cancelStroke() {
		isDrawing.value = false
		activePoints = []
		pathString = ''
		clearPreview()
	}

	function removeStrokeNode(id: string) {
		nodes.value = nodes.value.filter(n => n.id !== id)
	}

	return {
		isDrawing,
		previewPath,
		previewPointCount,
		startStroke,
		extendStroke,
		commitStroke,
		cancelStroke,
		removeStrokeNode,
	}
}

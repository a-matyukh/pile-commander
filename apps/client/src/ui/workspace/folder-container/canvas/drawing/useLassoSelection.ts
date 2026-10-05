import { ref, type Ref } from 'vue'
import type { EditorTool, Point } from './types'

export type LassoHits = {
	strokeIds: Set<string>
	widgetIds: Set<string>
	edgeIds: Set<string>
}

const EMPTY_HITS: LassoHits = {
	strokeIds: new Set(),
	widgetIds: new Set(),
	edgeIds: new Set(),
}

export function useLassoSelection(
	tool: Ref<EditorTool>,
	collectHits: (polygon: Point[]) => LassoHits,
	applySelection: (hits: LassoHits) => boolean,
) {
	// Hot path: same pattern as useCanvasDrawing — plain values mutated per
	// pointermove, reactive path updated once per animation frame.
	let lassoPoints: Point[] = []
	let pathString = ''
	let pendingFrame: number | null = null

	const lassoPath = ref('')

	function closedPath(): string {
		if (lassoPoints.length === 0) return ''
		if (lassoPoints.length < 3) return pathString
		const first = lassoPoints[0]
		return `${pathString} L ${first.x} ${first.y} Z`
	}

	function flushPreview() {
		pendingFrame = null
		lassoPath.value = closedPath()
	}

	function schedulePreview() {
		if (pendingFrame !== null) return
		pendingFrame = requestAnimationFrame(flushPreview)
	}

	function clearLasso() {
		if (pendingFrame !== null) {
			cancelAnimationFrame(pendingFrame)
			pendingFrame = null
		}
		lassoPoints = []
		pathString = ''
		lassoPath.value = ''
	}

	function startLasso(flowPoint: Point) {
		if (tool.value !== 'lasso') return
		applySelection(EMPTY_HITS)
		lassoPoints = [flowPoint]
		pathString = `M ${flowPoint.x} ${flowPoint.y}`
		flushPreview()
	}

	function extendLasso(flowPoint: Point) {
		if (tool.value !== 'lasso') return
		const last = lassoPoints[lassoPoints.length - 1]
		if (last && last.x === flowPoint.x && last.y === flowPoint.y) return
		lassoPoints.push(flowPoint)
		pathString += ` L ${flowPoint.x} ${flowPoint.y}`
		schedulePreview()
	}

	function commitLasso() {
		if (tool.value !== 'lasso') {
			clearLasso()
			return
		}

		const polygon = lassoPoints
		clearLasso()
		applySelection(collectHits(polygon))
	}

	function cancelLasso() {
		clearLasso()
	}

	return {
		lassoPath,
		startLasso,
		extendLasso,
		commitLasso,
		cancelLasso,
	}
}

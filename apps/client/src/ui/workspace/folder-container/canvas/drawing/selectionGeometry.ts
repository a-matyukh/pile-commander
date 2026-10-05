import type { HandlePosition } from '@/domain/Widget'
import type { Bounds } from '../../board/marqueeGeometry'
import {
	closePolygon,
	pointInPolygon,
	polygonArea,
	segmentIntersectsPolygon,
	segmentsIntersect,
} from './lassoGeometry'
import type { Point } from './types'

export type WidgetLayout = {
	id: string
	position: Point
	width: number
	height: number
}

export type EdgeLayout = {
	id: string
	source: string
	target: string
	sourceHandle?: string | null
	targetHandle?: string | null
}

export type FlowRect = Bounds

const BEZIER_SAMPLES = 20
const BEZIER_CURVATURE = 0.25

export function pointInRect(point: Point, rect: FlowRect): boolean {
	return (
		point.x >= rect.x
		&& point.x <= rect.x + rect.width
		&& point.y >= rect.y
		&& point.y <= rect.y + rect.height
	)
}

function rectCorners(rect: FlowRect): Point[] {
	return [
		{ x: rect.x, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y },
		{ x: rect.x + rect.width, y: rect.y + rect.height },
		{ x: rect.x, y: rect.y + rect.height },
	]
}

function rectEdges(rect: FlowRect): [Point, Point][] {
	const corners = rectCorners(rect)
	return [
		[corners[0]!, corners[1]!],
		[corners[1]!, corners[2]!],
		[corners[2]!, corners[3]!],
		[corners[3]!, corners[0]!],
	]
}

export function segmentIntersectsRect(a: Point, b: Point, rect: FlowRect): boolean {
	if (pointInRect(a, rect) || pointInRect(b, rect)) return true
	for (const [c, d] of rectEdges(rect)) {
		if (segmentsIntersect(a, b, c, d)) return true
	}
	return false
}

export function polylineHitsRect(points: Point[], rect: FlowRect): boolean {
	if (points.length === 0) return false
	if (points.length === 1) return pointInRect(points[0]!, rect)
	for (let i = 1; i < points.length; i++) {
		if (segmentIntersectsRect(points[i - 1]!, points[i]!, rect)) return true
	}
	return false
}

export function polylineHitsPolygon(points: Point[], polygon: Point[]): boolean {
	const closed = closePolygon(polygon)
	if (closed.length < 3 || points.length === 0) return false
	for (const point of points) {
		if (pointInPolygon(point, closed)) return true
	}
	for (let i = 1; i < points.length; i++) {
		if (segmentIntersectsPolygon(points[i - 1]!, points[i]!, closed)) return true
	}
	return false
}

/** AABB vs polygon, Partial-style: any overlap counts. */
export function rectHitsPolygon(rect: FlowRect, polygon: Point[]): boolean {
	const closed = closePolygon(polygon)
	if (closed.length < 3) return false

	for (const corner of rectCorners(rect)) {
		if (pointInPolygon(corner, closed)) return true
	}
	for (const vertex of closed) {
		if (pointInRect(vertex, rect)) return true
	}
	for (const [a, b] of rectEdges(rect)) {
		if (segmentIntersectsPolygon(a, b, closed)) return true
	}
	return false
}

export function parseHandlePosition(handleId: string | null | undefined): HandlePosition | undefined {
	if (!handleId) return undefined
	const base = handleId.replace(/-(source|target)$/, '')
	if (base === 'top' || base === 'right' || base === 'bottom' || base === 'left') {
		return base
	}
	return undefined
}

function handleAnchor(
	bounds: FlowRect,
	handle: HandlePosition | undefined,
	role: 'source' | 'target',
): { point: Point; position: HandlePosition } {
	const position = handle ?? (role === 'source' ? 'bottom' : 'top')
	const { x, y, width, height } = bounds
	switch (position) {
		case 'top':
			return { point: { x: x + width / 2, y }, position }
		case 'right':
			return { point: { x: x + width, y: y + height / 2 }, position }
		case 'left':
			return { point: { x, y: y + height / 2 }, position }
		case 'bottom':
			return { point: { x: x + width / 2, y: y + height }, position }
	}
}

function calculateControlOffset(distance: number, curvature: number): number {
	if (distance >= 0) return 0.5 * distance
	return curvature * 25 * Math.sqrt(-distance)
}

/** Control point matching Vue Flow / xyflow default bezier edges. */
function controlWithCurvature(
	pos: HandlePosition,
	x1: number,
	y1: number,
	x2: number,
	y2: number,
	curvature: number,
): Point {
	switch (pos) {
		case 'left':
			return { x: x1 - calculateControlOffset(x1 - x2, curvature), y: y1 }
		case 'right':
			return { x: x1 + calculateControlOffset(x2 - x1, curvature), y: y1 }
		case 'top':
			return { x: x1, y: y1 - calculateControlOffset(y1 - y2, curvature) }
		case 'bottom':
			return { x: x1, y: y1 + calculateControlOffset(y2 - y1, curvature) }
	}
}

function cubicBezierPoint(p0: Point, p1: Point, p2: Point, p3: Point, t: number): Point {
	const mt = 1 - t
	const mt2 = mt * mt
	const t2 = t * t
	return {
		x: mt2 * mt * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t2 * t * p3.x,
		y: mt2 * mt * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t2 * t * p3.y,
	}
}

export function sampleBezierEdge(
	source: Point,
	sourcePosition: HandlePosition,
	target: Point,
	targetPosition: HandlePosition,
	samples = BEZIER_SAMPLES,
): Point[] {
	const c1 = controlWithCurvature(
		sourcePosition,
		source.x,
		source.y,
		target.x,
		target.y,
		BEZIER_CURVATURE,
	)
	const c2 = controlWithCurvature(
		targetPosition,
		target.x,
		target.y,
		source.x,
		source.y,
		BEZIER_CURVATURE,
	)
	const points: Point[] = []
	const steps = Math.max(1, samples)
	for (let i = 0; i <= steps; i++) {
		points.push(cubicBezierPoint(source, c1, c2, target, i / steps))
	}
	return points
}

export function edgePathPoints(
	edge: EdgeLayout,
	widgetsById: Map<string, WidgetLayout>,
): Point[] | null {
	const sourceNode = widgetsById.get(edge.source)
	const targetNode = widgetsById.get(edge.target)
	if (!sourceNode || !targetNode) return null

	const sourceBounds: FlowRect = {
		x: sourceNode.position.x,
		y: sourceNode.position.y,
		width: sourceNode.width,
		height: sourceNode.height,
	}
	const targetBounds: FlowRect = {
		x: targetNode.position.x,
		y: targetNode.position.y,
		width: targetNode.width,
		height: targetNode.height,
	}
	const source = handleAnchor(sourceBounds, parseHandlePosition(edge.sourceHandle), 'source')
	const target = handleAnchor(targetBounds, parseHandlePosition(edge.targetHandle), 'target')
	return sampleBezierEdge(source.point, source.position, target.point, target.position)
}

export function widgetBounds(widget: WidgetLayout): FlowRect {
	return {
		x: widget.position.x,
		y: widget.position.y,
		width: widget.width,
		height: widget.height,
	}
}

export function findWidgetsInPolygon(
	widgets: WidgetLayout[],
	polygon: Point[],
): Set<string> {
	const ids = new Set<string>()
	const closed = closePolygon(polygon)
	if (closed.length < 3 || polygonArea(closed) < 0.5) return ids
	for (const widget of widgets) {
		if (rectHitsPolygon(widgetBounds(widget), closed)) ids.add(widget.id)
	}
	return ids
}

export function findEdgesInPolygon(
	edges: EdgeLayout[],
	widgets: WidgetLayout[],
	polygon: Point[],
): Set<string> {
	const ids = new Set<string>()
	const closed = closePolygon(polygon)
	if (closed.length < 3 || polygonArea(closed) < 0.5) return ids
	const widgetsById = new Map(widgets.map(widget => [widget.id, widget]))
	for (const edge of edges) {
		const path = edgePathPoints(edge, widgetsById)
		if (path && polylineHitsPolygon(path, closed)) ids.add(edge.id)
	}
	return ids
}

export function findEdgesInRect(
	edges: EdgeLayout[],
	widgets: WidgetLayout[],
	rect: FlowRect,
): Set<string> {
	const ids = new Set<string>()
	if (rect.width <= 0 && rect.height <= 0) return ids
	const widgetsById = new Map(widgets.map(widget => [widget.id, widget]))
	for (const edge of edges) {
		const path = edgePathPoints(edge, widgetsById)
		if (path && polylineHitsRect(path, rect)) ids.add(edge.id)
	}
	return ids
}

/** Convert Vue Flow pane-space selection rect into flow coordinates. */
export function paneRectToFlow(
	rect: { x: number; y: number; width: number; height: number },
	viewport: { x: number; y: number; zoom: number },
): FlowRect {
	const zoom = viewport.zoom || 1
	return {
		x: (rect.x - viewport.x) / zoom,
		y: (rect.y - viewport.y) / zoom,
		width: rect.width / zoom,
		height: rect.height / zoom,
	}
}

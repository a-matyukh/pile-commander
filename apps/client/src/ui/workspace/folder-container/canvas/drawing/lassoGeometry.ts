import type { FlowStrokeNode } from '@/services/canvas/strokes'
import type { Point } from './types'

export function getStrokeAbsolutePoints(node: FlowStrokeNode): Point[] {
	return node.data.points.map(p => ({
		x: p.x + node.position.x,
		y: p.y + node.position.y,
	}))
}

export function closePolygon(points: Point[]): Point[] {
	if (points.length < 3) return [...points]
	const first = points[0]
	const last = points[points.length - 1]
	if (first.x === last.x && first.y === last.y) return [...points]
	return [...points, first]
}

export function pointInPolygon(point: Point, polygon: Point[]): boolean {
	if (polygon.length < 3) return false

	let inside = false
	for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
		const xi = polygon[i].x
		const yi = polygon[i].y
		const xj = polygon[j].x
		const yj = polygon[j].y

		const intersect =
			yi > point.y !== yj > point.y &&
			point.x < ((xj - xi) * (point.y - yi)) / (yj - yi + 0.0000001) + xi

		if (intersect) inside = !inside
	}

	return inside
}

export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
	const cross = (p: Point, q: Point, r: Point) =>
		(q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)

	const d1 = cross(a1, a2, b1)
	const d2 = cross(a1, a2, b2)
	const d3 = cross(b1, b2, a1)
	const d4 = cross(b1, b2, a2)

	if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
		return true
	}

	return false
}

export function segmentIntersectsPolygon(a: Point, b: Point, polygon: Point[]): boolean {
	for (let i = 0; i < polygon.length; i++) {
		const c = polygon[i]
		const d = polygon[(i + 1) % polygon.length]
		if (segmentsIntersect(a, b, c, d)) return true
	}
	return false
}

export function polygonArea(points: Point[]): number {
	if (points.length < 3) return 0
	let area = 0
	for (let i = 0; i < points.length; i++) {
		const j = (i + 1) % points.length
		area += points[i].x * points[j].y - points[j].x * points[i].y
	}
	return Math.abs(area / 2)
}

export function isStrokeInPolygon(node: FlowStrokeNode, polygon: Point[]): boolean {
	const closed = closePolygon(polygon)
	if (closed.length < 3) return false

	const pts = getStrokeAbsolutePoints(node)
	if (pts.length === 0) return false

	for (const p of pts) {
		if (pointInPolygon(p, closed)) return true
	}

	const center = {
		x: node.position.x + node.data.width / 2,
		y: node.position.y + node.data.height / 2,
	}
	if (pointInPolygon(center, closed)) return true

	for (let i = 1; i < pts.length; i++) {
		if (segmentIntersectsPolygon(pts[i - 1], pts[i], closed)) return true
	}

	return false
}

export function findStrokesInPolygon(
	nodes: FlowStrokeNode[],
	polygon: Point[],
): Set<string> {
	const ids = new Set<string>()
	const closed = closePolygon(polygon)
	if (closed.length < 3 || polygonArea(closed) < 0.5) return ids

	for (const node of nodes) {
		if (node.type === 'stroke' && isStrokeInPolygon(node, closed)) {
			ids.add(node.id)
		}
	}
	return ids
}

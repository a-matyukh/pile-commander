import type { FlowStrokeNode } from '@/services/canvas/strokes'
import type { Point } from './types'

const PADDING = 4
const DEDUPE_MIN_DISTANCE = 0.08
const SIMPLIFY_THRESHOLD = 1500
const SIMPLIFY_MIN_DISTANCE = 0.35

export function pointsToPath(points: Point[], strokeWidth?: number): string {
	if (points.length === 0) return ''
	if (points.length === 1) {
		const p = points[0]
		const r = Math.max((strokeWidth ?? 4) / 2, 0.5)
		return `M ${p.x - r} ${p.y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0 Z`
	}
	const [first, ...rest] = points
	return `M ${first.x} ${first.y} ${rest.map(p => `L ${p.x} ${p.y}`).join(' ')}`
}

export function boundsFromPoints(points: Point[], strokeWidth: number) {
	if (points.length === 0) {
		return { minX: 0, minY: 0, width: 1, height: 1 }
	}

	let minX = points[0].x
	let minY = points[0].y
	let maxX = points[0].x
	let maxY = points[0].y

	for (const p of points) {
		minX = Math.min(minX, p.x)
		minY = Math.min(minY, p.y)
		maxX = Math.max(maxX, p.x)
		maxY = Math.max(maxY, p.y)
	}

	const pad = strokeWidth / 2 + PADDING
	const width = Math.max(maxX - minX + pad * 2, strokeWidth + pad)
	const height = Math.max(maxY - minY + pad * 2, strokeWidth + pad)

	return {
		minX: minX - pad,
		minY: minY - pad,
		width,
		height,
	}
}

export function absoluteToRelative(points: Point[], origin: Point): Point[] {
	return points.map(p => ({ x: p.x - origin.x, y: p.y - origin.y }))
}

/** Drops points closer than minDistance to the previous kept point (always keeps the last input point). */
export function filterPointsByMinDistance(points: Point[], minDistance: number): Point[] {
	if (points.length <= 1) return [...points]

	const result: Point[] = [points[0]]
	const minDistSq = minDistance * minDistance

	for (let i = 1; i < points.length; i++) {
		const last = result[result.length - 1]
		const p = points[i]
		const dx = p.x - last.x
		const dy = p.y - last.y
		if (dx * dx + dy * dy >= minDistSq) {
			result.push(p)
		}
	}

	const lastInput = points[points.length - 1]
	const lastResult = result[result.length - 1]
	if (lastResult.x !== lastInput.x || lastResult.y !== lastInput.y) {
		result.push(lastInput)
	}

	return result
}

export function strokeLength(points: Point[]): number {
	let length = 0
	for (let i = 1; i < points.length; i++) {
		const dx = points[i].x - points[i - 1].x
		const dy = points[i].y - points[i - 1].y
		length += Math.hypot(dx, dy)
	}
	return length
}

export function prepareStrokePoints(
	points: Point[],
	strokeWidth: number,
): Point[] | null {
	if (points.length === 0) return null

	let prepared = filterPointsByMinDistance(points, DEDUPE_MIN_DISTANCE)

	if (prepared.length === 1) {
		return prepared
	}

	const len = strokeLength(prepared)
	const dotThreshold = Math.max(0.2, strokeWidth * 0.15)
	if (len < dotThreshold) {
		return [prepared[0]]
	}

	if (prepared.length > SIMPLIFY_THRESHOLD) {
		prepared = filterPointsByMinDistance(prepared, SIMPLIFY_MIN_DISTANCE)
	}

	return prepared.length > 0 ? prepared : null
}

/** Persisted coordinates are quantized to 0.01 — keeps DB rows compact and stable. */
const quantize = (value: number) => Math.round(value * 100) / 100

export function buildFlowStrokeNode(
	id: string,
	absolutePoints: Point[],
	color: string,
	strokeWidth: number,
	z: number,
): FlowStrokeNode | null {
	const prepared = prepareStrokePoints(absolutePoints, strokeWidth)
	if (!prepared) return null

	const { minX, minY, width, height } = boundsFromPoints(prepared, strokeWidth)
	const relative = absoluteToRelative(prepared, { x: minX, y: minY })
		.map(p => ({ x: quantize(p.x), y: quantize(p.y) }))

	return {
		id,
		type: 'stroke' as const,
		z,
		position: { x: quantize(minX), y: quantize(minY) },
		width,
		height,
		dimensions: { width, height },
		data: {
			points: relative,
			color,
			strokeWidth,
			width,
			height,
			pathD: pointsToPath(relative, strokeWidth),
		},
		style: {
			width: `${width}px`,
			height: `${height}px`,
		},
		zIndex: 1,
	}
}

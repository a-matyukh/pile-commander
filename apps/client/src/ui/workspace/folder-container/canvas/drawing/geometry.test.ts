import { describe, expect, test } from 'vitest'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import {
	closePolygon,
	findStrokesInPolygon,
	pointInPolygon,
	polygonArea,
} from './lassoGeometry'
import { boundsFromPoints, buildFlowStrokeNode, pointsToPath } from './strokePath'
import {
	findEdgesInPolygon,
	findEdgesInRect,
	findWidgetsInPolygon,
	paneRectToFlow,
	polylineHitsRect,
} from './selectionGeometry'

function stroke(id: string, points: { x: number; y: number }[], position = { x: 0, y: 0 }): FlowStrokeNode {
	return {
		id,
		type: 'stroke',
		z: 1,
		position,
		width: 20,
		height: 20,
		dimensions: { width: 20, height: 20 },
		data: {
			points,
			color: '#000',
			strokeWidth: 2,
			width: 20,
			height: 20,
		},
	}
}

describe('lassoGeometry', () => {
	const square = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	]

	test('closePolygon appends the first point when open', () => {
		expect(closePolygon(square)).toEqual([...square, square[0]])
		expect(closePolygon([...square, square[0]])).toEqual([...square, square[0]])
	})

	test('pointInPolygon detects inside and outside points', () => {
		expect(pointInPolygon({ x: 5, y: 5 }, square)).toBe(true)
		expect(pointInPolygon({ x: 15, y: 5 }, square)).toBe(false)
	})

	test('polygonArea returns expected square area', () => {
		expect(polygonArea(square)).toBe(100)
		expect(polygonArea([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(0)
	})

	test('findStrokesInPolygon selects intersecting strokes', () => {
		const nodes = [
			stroke('inside', [{ x: 2, y: 2 }, { x: 3, y: 3 }]),
			stroke('outside', [{ x: 20, y: 20 }, { x: 21, y: 21 }]),
			stroke('offset-inside', [{ x: 1, y: 1 }], { x: 4, y: 4 }),
		]

		expect([...findStrokesInPolygon(nodes, square)].sort()).toEqual([
			'inside',
			'offset-inside',
		])
	})
})

describe('strokePath', () => {
	test('pointsToPath builds move/line commands', () => {
		expect(pointsToPath([])).toBe('')
		expect(pointsToPath([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toBe('M 1 2 L 3 4')
	})

	test('boundsFromPoints pads stroke bounds', () => {
		const bounds = boundsFromPoints([{ x: 0, y: 0 }, { x: 10, y: 10 }], 4)
		expect(bounds.width).toBeGreaterThan(10)
		expect(bounds.height).toBeGreaterThan(10)
		expect(bounds.minX).toBeLessThan(0)
		expect(bounds.minY).toBeLessThan(0)
	})

	test('buildFlowStrokeNode quantizes coordinates to 0.01 and carries z', () => {
		const node = buildFlowStrokeNode('s1', [
			{ x: 10.001, y: 20.004 },
			{ x: 30.009, y: 40.006 },
		], '#000', 2, 7)
		expect(node).not.toBeNull()
		expect(node!.z).toBe(7)
		for (const p of node!.data.points) {
			expect(p.x * 100).toBeCloseTo(Math.round(p.x * 100), 5)
			expect(p.y * 100).toBeCloseTo(Math.round(p.y * 100), 5)
		}
		expect(node!.position.x * 100).toBeCloseTo(Math.round(node!.position.x * 100), 5)
	})
})

describe('selectionGeometry', () => {
	const square = [
		{ x: 0, y: 0 },
		{ x: 10, y: 0 },
		{ x: 10, y: 10 },
		{ x: 0, y: 10 },
	]

	test('findWidgetsInPolygon selects overlapping AABBs', () => {
		const widgets = [
			{ id: 'inside', position: { x: 2, y: 2 }, width: 4, height: 4 },
			{ id: 'overlap', position: { x: 8, y: 8 }, width: 10, height: 10 },
			{ id: 'outside', position: { x: 40, y: 40 }, width: 4, height: 4 },
		]
		expect([...findWidgetsInPolygon(widgets, square)].sort()).toEqual([
			'inside',
			'overlap',
		])
	})

	test('findEdgesInRect hits a connection whose curve crosses the marquee', () => {
		const widgets = [
			{ id: 'a', position: { x: 0, y: 0 }, width: 20, height: 20 },
			{ id: 'b', position: { x: 200, y: 0 }, width: 20, height: 20 },
		]
		const edges = [{
			id: 'c1',
			source: 'a',
			target: 'b',
			sourceHandle: 'right-source',
			targetHandle: 'left-target',
		}]
		const midRect = { x: 80, y: 0, width: 40, height: 40 }
		expect([...findEdgesInRect(edges, widgets, midRect)]).toEqual(['c1'])

		const farRect = { x: 80, y: 80, width: 40, height: 40 }
		expect([...findEdgesInRect(edges, widgets, farRect)]).toEqual([])
	})

	test('findEdgesInPolygon hits a connection crossing the lasso', () => {
		const widgets = [
			{ id: 'a', position: { x: 0, y: 0 }, width: 20, height: 20 },
			{ id: 'b', position: { x: 200, y: 0 }, width: 20, height: 20 },
		]
		const edges = [{
			id: 'c1',
			source: 'a',
			target: 'b',
			sourceHandle: 'right-source',
			targetHandle: 'left-target',
		}]
		const lasso = [
			{ x: 80, y: -10 },
			{ x: 140, y: -10 },
			{ x: 140, y: 30 },
			{ x: 80, y: 30 },
		]
		expect([...findEdgesInPolygon(edges, widgets, lasso)]).toEqual(['c1'])
	})

	test('polylineHitsRect detects a segment crossing the box', () => {
		expect(polylineHitsRect(
			[{ x: 0, y: 5 }, { x: 20, y: 5 }],
			{ x: 8, y: 0, width: 4, height: 10 },
		)).toBe(true)
		expect(polylineHitsRect(
			[{ x: 0, y: 20 }, { x: 20, y: 20 }],
			{ x: 8, y: 0, width: 4, height: 10 },
		)).toBe(false)
	})

	test('paneRectToFlow converts Vue Flow overlay coords using viewport', () => {
		expect(paneRectToFlow(
			{ x: 120, y: 80, width: 40, height: 20 },
			{ x: 20, y: 10, zoom: 2 },
		)).toEqual({ x: 50, y: 35, width: 20, height: 10 })
	})
})

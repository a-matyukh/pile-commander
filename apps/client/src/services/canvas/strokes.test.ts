import { describe, expect, test } from 'vitest'
import type { StrokeNode } from '@/domain/Widget'
import type { FolderStroke } from '@pile-commander/file-manager'
import {
	flow_node_to_stroke,
	folder_stroke_to_node,
	node_to_folder_stroke,
	stroke_to_flow_node,
} from './strokes'

const stroke = (partial: Partial<StrokeNode> & Pick<StrokeNode, 'id'>): StrokeNode => ({
	type: 'stroke',
	z: 1,
	position: { x: 0, y: 0 },
	points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
	color: '#000',
	stroke_width: 2,
	width: 20,
	height: 20,
	...partial,
})

describe('canvas strokes', () => {
	test('round-trips through flow node adapter', () => {
		const original = stroke({
			id: 's1',
			z: 7,
			position: { x: 3, y: 4 },
			stroke_width: 5,
		})
		const flow = stroke_to_flow_node(original)
		expect(flow.z).toBe(7)
		expect(flow.data.strokeWidth).toBe(5)
		expect(flow.width).toBe(20)
		expect(flow.height).toBe(20)
		expect(flow.dimensions).toEqual({ width: 20, height: 20 })
		expect(flow_node_to_stroke(flow)).toEqual(original)
	})

	test('folder_stroke_to_node maps the storage row, including z', () => {
		const row: FolderStroke = {
			id: 's1',
			z: 3,
			position: { x: 10, y: 20 },
			points: [{ x: 0, y: 0 }, { x: 1.5, y: 2.5 }],
			color: '#fff',
			stroke_width: 4,
			width: 30,
			height: 40,
		}
		expect(folder_stroke_to_node(row)).toEqual({
			id: 's1',
			type: 'stroke',
			z: 3,
			position: { x: 10, y: 20 },
			points: [{ x: 0, y: 0 }, { x: 1.5, y: 2.5 }],
			color: '#fff',
			stroke_width: 4,
			width: 30,
			height: 40,
		})
	})

	test('node_to_folder_stroke round-trips with folder_stroke_to_node', () => {
		const row: FolderStroke = {
			id: 's2',
			z: 11,
			position: { x: -5.25, y: 0.5 },
			points: [{ x: 0, y: 0 }],
			color: '#123456',
			stroke_width: 1,
			width: 8,
			height: 9,
		}
		expect(node_to_folder_stroke(folder_stroke_to_node(row))).toEqual(row)
	})
})

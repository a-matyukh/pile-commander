import { describe, expect, test, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { NodeChange } from '@vue-flow/core'
import type { BoardSnapSettings } from '@/services/board/layout'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import type { EditorTool } from './drawing/types'
import { useCanvasFlow } from './useCanvasFlow'
import type { CanvasFlowNode } from './useCanvasNodes'
import store from '@/store'

vi.mock('@/store', () => ({
	default: { workspace: null as unknown },
}))

vi.mock('./CanvasLabeledEdge.vue', () => ({ default: {} }))
vi.mock('./CanvasWidgetNode.vue', () => ({ default: {} }))
vi.mock('./drawing/StrokeNode.vue', () => ({ default: {} }))

function stroke(id: string): FlowStrokeNode {
	return {
		id,
		type: 'stroke',
		z: 1,
		position: { x: 0, y: 0 },
		width: 10,
		height: 10,
		dimensions: { width: 10, height: 10 },
		data: {
			points: [{ x: 0, y: 0 }, { x: 8, y: 8 }],
			color: '#000',
			strokeWidth: 2,
			width: 10,
			height: 10,
		},
		selected: true,
	}
}

function card(id: string, selected: boolean): CanvasFlowNode {
	return { id, type: 'folderWidget', position: { x: 0, y: 0 }, data: { widget: {} }, selected } as unknown as CanvasFlowNode
}

/** Which nodes the tool lets be dragged: a selected and a plain stroke, a selected and a plain card */
function draggable_with(tool: EditorTool, options: { can_write?: boolean; panOnly?: boolean } = {}) {
	;(store as { workspace: unknown }).workspace = { can_write: options.can_write ?? true, selection: [] }
	const { flowNodes } = useCanvasFlow({
		widgetNodes: ref([card('w-selected', true), card('w-plain', false)]),
		strokeNodes: ref([stroke('s-selected'), { ...stroke('s-plain'), selected: false }]),
		edges: ref([]),
		editingNoteId: ref(null),
		tool: ref(tool),
		panOnly: ref(options.panOnly ?? false),
		boardSnapSettings: computed<BoardSnapSettings>(() => ({ snap_to_grid: false, grid_size: 20 })),
		deleteStrokes: async () => {},
	})
	return flowNodes.value.filter(node => node.draggable).map(node => node.id)
}

describe('useCanvasFlow dragging', () => {
	test('Select drags everything, Hand drags cards', () => {
		expect(draggable_with('select')).toEqual(['s-selected', 's-plain', 'w-selected', 'w-plain'])
		expect(draggable_with('hand')).toEqual(['w-selected', 'w-plain'])
	})

	test('the lasso drags what it selected and nothing else', () => {
		expect(draggable_with('lasso')).toEqual(['s-selected', 'w-selected'])
	})

	test('the drawing and connecting tools drag nothing', () => {
		expect(draggable_with('pen')).toEqual([])
		expect(draggable_with('eraser')).toEqual([])
		expect(draggable_with('connect')).toEqual([])
	})

	test('a viewer drags nothing, whatever is selected', () => {
		expect(draggable_with('lasso', { can_write: false })).toEqual([])
		expect(draggable_with('select', { can_write: false })).toEqual([])
	})

	test('Space held to move the canvas leaves the cards where they are', () => {
		expect(draggable_with('hand', { panOnly: true })).toEqual([])
	})
})

describe('useCanvasFlow keyboard stroke delete', () => {
	test('persists Vue Flow remove changes for selected strokes', () => {
		;(store as { workspace: unknown }).workspace = { can_write: true, selection: [] }
		const deleteStrokes = vi.fn(async () => {})
		const strokeNodes = ref([stroke('s1'), stroke('s2')])
		const { onNodesChange } = useCanvasFlow({
			widgetNodes: ref([]),
			strokeNodes,
			edges: ref([]),
			editingNoteId: ref(null),
			tool: ref('select'),
			boardSnapSettings: computed<BoardSnapSettings>(() => ({
				snap_to_grid: false,
				grid_size: 20,
			})),
			deleteStrokes,
		})

		onNodesChange([
			{ type: 'remove', id: 's1' },
			{ type: 'remove', id: 's2' },
		] as NodeChange[])

		expect(strokeNodes.value.map(n => n.id)).toEqual([])
		expect(deleteStrokes).toHaveBeenCalledWith(['s1', 's2'])
	})

	test('does not persist a remove after the toolbar already dropped the stroke', () => {
		;(store as { workspace: unknown }).workspace = { can_write: true, selection: [] }
		const deleteStrokes = vi.fn(async () => {})
		const strokeNodes = ref([stroke('s2')])
		const { onNodesChange } = useCanvasFlow({
			widgetNodes: ref([]),
			strokeNodes,
			edges: ref([]),
			editingNoteId: ref(null),
			tool: ref('select'),
			boardSnapSettings: computed<BoardSnapSettings>(() => ({
				snap_to_grid: false,
				grid_size: 20,
			})),
			deleteStrokes,
		})

		onNodesChange([{ type: 'remove', id: 's1' }] as NodeChange[])

		expect(deleteStrokes).not.toHaveBeenCalled()
		expect(strokeNodes.value.map(n => n.id)).toEqual(['s2'])
	})
})

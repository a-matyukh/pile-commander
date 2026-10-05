import { describe, expect, test, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { NodeChange } from '@vue-flow/core'
import type { BoardSnapSettings } from '@/services/board/layout'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import { useCanvasFlow } from './useCanvasFlow'
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

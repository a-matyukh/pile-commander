import { describe, expect, test, vi } from 'vitest'
import { computed, ref } from 'vue'
import type { NodeDragEvent, NodeMouseEvent } from '@vue-flow/core'
import type { EditorTool } from './drawing/types'
import { useCanvasNodeInteractions } from './useCanvasNodeInteractions'
import store from '@/store'

vi.mock('@/store', () => ({
	default: { workspace: null as unknown },
}))

function makeOptions() {
	return {
		tool: ref<EditorTool>('select'),
		hoveredNodeId: ref<string | null>(null),
		isStrokeDragging: ref(false),
		isWidgetDragging: ref(false),
		setStrokePosition: vi.fn(),
		setWidgetPosition: vi.fn(),
		persistStrokes: vi.fn(async () => {}),
		deleteStrokes: vi.fn(async () => {}),
		onWidgetDragStop: vi.fn(async () => {}),
		removeStrokeNode: vi.fn(),
		removeConnection: vi.fn(async () => {}),
		selectedStrokeIds: computed(() => [] as string[]),
		removeNodes: vi.fn(),
	}
}

const dragEvent = (nodes: { id: string; type?: string; position: { x: number; y: number } }[]) =>
	({ node: nodes[0], nodes, event: {} }) as unknown as NodeDragEvent

describe('useCanvasNodeInteractions', () => {
	test('stroke drag stop persists only the dragged stroke ids', async () => {
		const options = makeOptions()
		const interactions = useCanvasNodeInteractions(options)

		await interactions.onNodeDragStop(dragEvent([
			{ id: 's1', type: 'stroke', position: { x: 10, y: 20 } },
			{ id: 's2', type: 'stroke', position: { x: 30, y: 40 } },
		]))

		expect(options.setStrokePosition).toHaveBeenCalledWith('s1', { x: 10, y: 20 })
		expect(options.setStrokePosition).toHaveBeenCalledWith('s2', { x: 30, y: 40 })
		expect(options.persistStrokes).toHaveBeenCalledWith(['s1', 's2'])
		expect(options.isStrokeDragging.value).toBe(false)
		expect(options.onWidgetDragStop).not.toHaveBeenCalled()
	})

	test('eraser click removes the stroke and persists the deletion', () => {
		const options = makeOptions()
		options.tool.value = 'eraser'
		const interactions = useCanvasNodeInteractions(options)

		interactions.onNodeClick({
			node: { id: 's1', type: 'stroke' },
			event: {},
		} as unknown as NodeMouseEvent)

		expect(options.removeStrokeNode).toHaveBeenCalledWith('s1')
		expect(options.removeNodes).toHaveBeenCalledWith(['s1'])
		expect(options.deleteStrokes).toHaveBeenCalledWith(['s1'])
	})

	test('deleteSelectedStrokes persists deletions of the selected strokes', () => {
		;(store as { workspace: unknown }).workspace = { can_write: true }
		const options = makeOptions()
		options.tool.value = 'lasso'
		options.selectedStrokeIds = computed(() => ['s1', 's2'])
		const interactions = useCanvasNodeInteractions(options)

		interactions.deleteSelectedStrokes()

		expect(options.removeStrokeNode).toHaveBeenCalledWith('s1')
		expect(options.removeStrokeNode).toHaveBeenCalledWith('s2')
		expect(options.deleteStrokes).toHaveBeenCalledWith(['s1', 's2'])
	})

	test('deleteSelectedStrokes refuses read-only workspaces', () => {
		;(store as { workspace: unknown }).workspace = { can_write: false }
		const options = makeOptions()
		options.selectedStrokeIds = computed(() => ['s1'])
		const interactions = useCanvasNodeInteractions(options)

		interactions.deleteSelectedStrokes()

		expect(options.removeStrokeNode).not.toHaveBeenCalled()
		expect(options.deleteStrokes).not.toHaveBeenCalled()
	})

	test('mixed drag stop persists strokes and widgets', async () => {
		const options = makeOptions()
		const interactions = useCanvasNodeInteractions(options)

		await interactions.onNodeDragStop(dragEvent([
			{ id: 's1', type: 'stroke', position: { x: 10, y: 20 } },
			{ id: 'w1', type: 'folderWidget', position: { x: 50, y: 60 } },
		]))

		expect(options.setStrokePosition).toHaveBeenCalledWith('s1', { x: 10, y: 20 })
		expect(options.persistStrokes).toHaveBeenCalledWith(['s1'])
		expect(options.setWidgetPosition).toHaveBeenCalledWith('w1', { x: 50, y: 60 })
		expect(options.onWidgetDragStop).toHaveBeenCalled()
		expect(options.isStrokeDragging.value).toBe(false)
		expect(options.isWidgetDragging.value).toBe(false)
	})
})

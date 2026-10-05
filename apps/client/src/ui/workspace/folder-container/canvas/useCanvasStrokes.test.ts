import { describe, expect, test, vi } from 'vitest'
import { computed, nextTick, reactive, ref } from 'vue'
import type { StrokeNode } from '@/domain/Widget'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import { useCanvasStrokes } from './useCanvasStrokes'
import store from '@/store'

vi.mock('@/store', () => ({
	default: { workspace: null as unknown },
}))

function setWorkspace(ws: unknown) {
	;(store as { workspace: unknown }).workspace = ws
}

function stroke(partial: Partial<StrokeNode> & Pick<StrokeNode, 'id'>): StrokeNode {
	return {
		type: 'stroke',
		z: 1,
		position: { x: 0, y: 0 },
		points: [{ x: 0, y: 0 }, { x: 10, y: 10 }],
		color: '#000',
		stroke_width: 2,
		width: 20,
		height: 20,
		...partial,
	}
}

function makeWorkspace(initial: Record<string, StrokeNode[]>) {
	const strokes_by_folder = reactive<Record<string, StrokeNode[]>>({ ...initial })
	return {
		can_write: true,
		strokes_by_folder,
		strokes_for: (folder_id: string) => strokes_by_folder[folder_id] ?? [],
		ensure_strokes: vi.fn(async () => {}),
		upsert_strokes: vi.fn(async (folder_id: string, strokes: StrokeNode[]) => {
			const by_id = new Map((strokes_by_folder[folder_id] ?? []).map(s => [s.id, s]))
			for (const s of strokes) by_id.set(s.id, s)
			strokes_by_folder[folder_id] = [...by_id.values()].sort((a, b) => a.z - b.z)
		}),
		delete_strokes: vi.fn(async (folder_id: string, ids: string[]) => {
			const doomed = new Set(ids)
			strokes_by_folder[folder_id] = (strokes_by_folder[folder_id] ?? [])
				.filter(s => !doomed.has(s.id))
		}),
	}
}

function flowStroke(partial: Partial<FlowStrokeNode> & Pick<FlowStrokeNode, 'id'>): FlowStrokeNode {
	return {
		type: 'stroke',
		z: 1,
		position: { x: 0, y: 0 },
		width: 20,
		height: 20,
		dimensions: { width: 20, height: 20 },
		data: {
			points: [{ x: 0, y: 0 }],
			color: '#000',
			strokeWidth: 2,
			width: 20,
			height: 20,
		},
		...partial,
	}
}

describe('useCanvasStrokes', () => {
	function setup(
		ws: ReturnType<typeof makeWorkspace>,
		folderId: string,
		options?: { isStrokeDragging?: boolean },
	) {
		setWorkspace(ws)
		const folderRef = ref(folderId)
		const dragging = ref(options?.isStrokeDragging ?? false)
		const canvas = useCanvasStrokes(computed(() => folderRef.value), {
			isStrokeDragging: computed(() => dragging.value),
		})
		return { folderRef, dragging, ...canvas }
	}

	test('mirrors the store strokes of the current folder', async () => {
		const ws = makeWorkspace({ '/a': [stroke({ id: 'ink-a' })] })
		const { strokeNodes } = setup(ws, '/a')
		await nextTick()
		expect(strokeNodes.value.map(n => n.id)).toEqual(['ink-a'])
	})

	test('switches folders without writing the previous folder back', async () => {
		const ws = makeWorkspace({
			'/a': [stroke({ id: 'ink-a' })],
			'/b': [stroke({ id: 'ink-b' })],
		})
		const { folderRef, strokeNodes } = setup(ws, '/a')
		await nextTick()
		expect(strokeNodes.value.map(n => n.id)).toEqual(['ink-a'])

		folderRef.value = '/b'
		await nextTick()

		expect(strokeNodes.value.map(n => n.id)).toEqual(['ink-b'])
		expect(ws.ensure_strokes).toHaveBeenCalledWith('/b')
		expect(ws.upsert_strokes).not.toHaveBeenCalled()
	})

	test('applies remote per-id updates incrementally', async () => {
		const ws = makeWorkspace({ '/a': [stroke({ id: 'ink-a', z: 1 })] })
		const { strokeNodes } = setup(ws, '/a')
		await nextTick()

		// another client: moved ink-a, added ink-b after it
		ws.strokes_by_folder['/a'] = [
			stroke({ id: 'ink-a', z: 1, position: { x: 50, y: 60 } }),
			stroke({ id: 'ink-b', z: 2 }),
		]
		await nextTick()

		expect(strokeNodes.value.map(n => n.id)).toEqual(['ink-a', 'ink-b'])
		expect(strokeNodes.value[0]!.position).toEqual({ x: 50, y: 60 })
	})

	test('pauses sync while a stroke is being dragged', async () => {
		const ws = makeWorkspace({ '/a': [stroke({ id: 'ink-a' })] })
		const { strokeNodes, dragging } = setup(ws, '/a')
		await nextTick()

		dragging.value = true
		ws.strokes_by_folder['/a'] = [stroke({ id: 'ink-a', position: { x: 9, y: 9 } })]
		await nextTick()
		expect(strokeNodes.value[0]!.position).toEqual({ x: 0, y: 0 })

		dragging.value = false
		ws.strokes_by_folder['/a'] = [...ws.strokes_by_folder['/a']!]
		await nextTick()
		expect(strokeNodes.value[0]!.position).toEqual({ x: 9, y: 9 })
	})

	test('pen commit upserts the stroke with the next z', async () => {
		const ws = makeWorkspace({ '/a': [stroke({ id: 'ink-a', z: 4 })] })
		const { strokeNodes, nextStrokeZ, onStrokeCommit } = setup(ws, '/a')
		await nextTick()

		expect(nextStrokeZ()).toBe(5)
		const built = flowStroke({ id: 'ink-new', z: nextStrokeZ() })
		strokeNodes.value = [...strokeNodes.value, built]
		onStrokeCommit(built)

		expect(ws.upsert_strokes).toHaveBeenCalledWith('/a', [
			expect.objectContaining({ id: 'ink-new', z: 5, type: 'stroke' }),
		])
	})

	test('persistStrokes upserts only the dragged ids', async () => {
		const ws = makeWorkspace({
			'/a': [stroke({ id: 'ink-a', z: 1 }), stroke({ id: 'ink-b', z: 2 })],
		})
		const { strokeNodes, persistStrokes } = setup(ws, '/a')
		await nextTick()

		strokeNodes.value = strokeNodes.value.map(n =>
			n.id === 'ink-a' ? { ...n, position: { x: 100, y: 100 } } : n,
		)
		await persistStrokes(['ink-a'])

		expect(ws.upsert_strokes).toHaveBeenCalledTimes(1)
		const [, strokes] = ws.upsert_strokes.mock.calls[0]!
		expect(strokes).toHaveLength(1)
		expect(strokes![0]).toMatchObject({ id: 'ink-a', z: 1, position: { x: 100, y: 100 } })
	})

	test('deleteStrokes removes through the store', async () => {
		const ws = makeWorkspace({ '/a': [stroke({ id: 'ink-a' }), stroke({ id: 'ink-b', z: 2 })] })
		const { strokeNodes, deleteStrokes } = setup(ws, '/a')
		await nextTick()

		strokeNodes.value = strokeNodes.value.filter(n => n.id !== 'ink-a')
		await deleteStrokes(['ink-a'])

		expect(ws.delete_strokes).toHaveBeenCalledWith('/a', ['ink-a'])
	})

	test('does not write in read-only workspaces', async () => {
		const ws = makeWorkspace({ '/a': [] })
		ws.can_write = false
		const { onStrokeCommit, deleteStrokes } = setup(ws, '/a')
		await nextTick()

		onStrokeCommit(flowStroke({ id: 'ink-x' }))
		await deleteStrokes(['ink-x'])
		expect(ws.upsert_strokes).not.toHaveBeenCalled()
		expect(ws.delete_strokes).not.toHaveBeenCalled()
	})
})

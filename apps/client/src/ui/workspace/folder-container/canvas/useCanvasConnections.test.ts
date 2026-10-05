import { describe, expect, test, vi } from 'vitest'
import { computed, nextTick, reactive, ref } from 'vue'
import type { Connection, FolderContainerWidget } from '@/domain/Widget'
import { useCanvasConnections } from './useCanvasConnections'
import store from '@/store'

vi.mock('@/store', () => ({
	default: { workspace: null as unknown },
}))

function setWorkspace(ws: unknown) {
	;(store as { workspace: unknown }).workspace = ws
}

function conn(partial: Partial<Connection> & Pick<Connection, 'id' | 'from' | 'to'>): Connection {
	return { is_animated: false, ...partial }
}

function makeWorkspace(initial: Record<string, Connection[]>) {
	const connections_by_folder = reactive<Record<string, Connection[]>>({ ...initial })
	return {
		can_write: true,
		connections_by_folder,
		connections_for: (folder_id: string) => connections_by_folder[folder_id] ?? [],
		ensure_connections: vi.fn(async () => {}),
		upsert_connections: vi.fn(async (folder_id: string, connections: Connection[]) => {
			const by_id = new Map((connections_by_folder[folder_id] ?? []).map(c => [c.id, c]))
			for (const c of connections) by_id.set(c.id, c)
			connections_by_folder[folder_id] = [...by_id.values()]
		}),
		delete_connections: vi.fn(async (folder_id: string, ids: string[]) => {
			const doomed = new Set(ids)
			connections_by_folder[folder_id] = (connections_by_folder[folder_id] ?? [])
				.filter(c => !doomed.has(c.id))
		}),
	}
}

function makeContainer(child_ids: string[]): FolderContainerWidget {
	return {
		id: '/a',
		name: 'a',
		type: 'folder_container',
		view: 'canvas',
		children: child_ids.map(id => ({
			id,
			name: id.split('/').pop() ?? id,
			type: 'file' as const,
		})),
	}
}

describe('useCanvasConnections', () => {
	function setup(
		ws: ReturnType<typeof makeWorkspace>,
		folderId: string,
		child_ids: string[],
	) {
		setWorkspace(ws)
		const folderRef = ref(folderId)
		const containerRef = ref<FolderContainerWidget | null>(makeContainer(child_ids))
		const canvas = useCanvasConnections(
			computed(() => folderRef.value),
			computed(() => containerRef.value),
		)
		return { folderRef, containerRef, ...canvas }
	}

	test('mirrors the store connections of the current folder', async () => {
		const ws = makeWorkspace({
			'/a': [conn({
				id: 'c1',
				from: '/a/x',
				to: '/a/y',
				from_handle: 'top',
				marker_end: 'arrow',
				is_animated: true,
			})],
		})
		const { edges } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		expect(edges.value).toHaveLength(1)
		expect(edges.value[0]).toMatchObject({
			id: 'c1',
			source: '/a/x',
			target: '/a/y',
			sourceHandle: 'top-source',
			targetHandle: undefined,
			animated: true,
			markerEnd: { type: 'arrow', width: 25, height: 25, markerUnits: 'userSpaceOnUse' },
			type: 'labeled',
		})
	})

	test('maps a connection label onto the vue-flow edge', async () => {
		const ws = makeWorkspace({
			'/a': [conn({
				id: 'c1',
				from: '/a/x',
				to: '/a/y',
				label: 'Square marker',
			})],
		})
		const { edges } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		expect(edges.value[0]).toMatchObject({
			id: 'c1',
			type: 'labeled',
			label: 'Square marker',
		})
	})

	test('applies remote per-id updates incrementally', async () => {
		const ws = makeWorkspace({
			'/a': [conn({ id: 'c1', from: '/a/x', to: '/a/y' })],
		})
		const { edges } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		// another client: animated c1, added c2
		ws.connections_by_folder['/a'] = [
			conn({ id: 'c1', from: '/a/x', to: '/a/y', is_animated: true }),
			conn({ id: 'c2', from: '/a/y', to: '/a/x', marker_start: 'arrowclosed' }),
		]
		await nextTick()

		expect(edges.value.map(e => e.id)).toEqual(['c1', 'c2'])
		expect(edges.value[0]!.animated).toBe(true)
		expect(edges.value[1]!.markerStart).toMatchObject({
			type: 'arrowclosed',
			width: 25,
			height: 25,
			markerUnits: 'userSpaceOnUse',
		})
	})

	test('hides orphan edges at render time until both endpoints exist', async () => {
		const ws = makeWorkspace({
			'/a': [
				conn({ id: 'c1', from: '/a/x', to: '/a/missing' }),
				conn({ id: 'c2', from: '/a/x', to: '/a/y' }),
			],
		})
		const { edges, containerRef } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()
		expect(edges.value.map(e => e.id)).toEqual(['c2'])

		// the endpoint widget arrives (multiplayer ordering)
		containerRef.value = makeContainer(['/a/x', '/a/y', '/a/missing'])
		await nextTick()
		expect(edges.value.map(e => e.id)).toEqual(['c1', 'c2'])
	})

	test('switches folders without writing the previous folder back', async () => {
		const ws = makeWorkspace({
			'/a': [conn({ id: 'c1', from: '/a/x', to: '/a/y' })],
			'/b': [conn({ id: 'c2', from: '/b/x', to: '/b/y' })],
		})
		const { folderRef, containerRef, edges } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()
		expect(edges.value.map(e => e.id)).toEqual(['c1'])

		containerRef.value = { ...makeContainer(['/b/x', '/b/y']), id: '/b' }
		folderRef.value = '/b'
		await nextTick()

		expect(edges.value.map(e => e.id)).toEqual(['c2'])
		expect(ws.ensure_connections).toHaveBeenCalledWith('/b')
		expect(ws.upsert_connections).not.toHaveBeenCalled()
	})

	test('onConnect upserts only the new connection', async () => {
		const ws = makeWorkspace({
			'/a': [conn({ id: 'c1', from: '/a/x', to: '/a/y' })],
		})
		const { onConnect } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		await onConnect({ source: '/a/y', target: '/a/x', sourceHandle: 'left-source', targetHandle: 'right-target' })

		expect(ws.upsert_connections).toHaveBeenCalledTimes(1)
		expect(ws.upsert_connections).toHaveBeenCalledWith('/a', [
			{
				id: '/a/y:left-/a/x:right',
				from: '/a/y',
				to: '/a/x',
				from_handle: 'left',
				to_handle: 'right',
				is_animated: false,
			},
		])
	})

	test('onConnect dedups by endpoints+handles and refuses self-loops', async () => {
		const ws = makeWorkspace({
			'/a': [conn({ id: 'c1', from: '/a/x', to: '/a/y', from_handle: 'top' })],
		})
		const { onConnect } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		await onConnect({ source: '/a/x', target: '/a/y', sourceHandle: 'top-source', targetHandle: null })
		await onConnect({ source: '/a/x', target: '/a/x', sourceHandle: null, targetHandle: null })

		expect(ws.upsert_connections).not.toHaveBeenCalled()
	})

	test('onEdgesChange deletes removed edges by id', async () => {
		const ws = makeWorkspace({
			'/a': [
				conn({ id: 'c1', from: '/a/x', to: '/a/y' }),
				conn({ id: 'c2', from: '/a/y', to: '/a/x' }),
			],
		})
		const { edges, onEdgesChange, removeConnection } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		await removeConnection('c1')
		expect(ws.delete_connections).toHaveBeenCalledWith('/a', ['c1'])
		await nextTick()
		expect(edges.value.map(e => e.id)).toEqual(['c2'])

		await onEdgesChange([{
			type: 'remove',
			id: 'c2',
			source: '/a/y',
			target: '/a/x',
			sourceHandle: null,
			targetHandle: null,
		}])
		expect(ws.delete_connections).toHaveBeenCalledWith('/a', ['c2'])
	})

	test('keeps edge selection across store-triggered rebuilds', async () => {
		const ws = makeWorkspace({
			'/a': [conn({ id: 'c1', from: '/a/x', to: '/a/y', marker_end: 'arrow' })],
		})
		const { edges, onEdgesChange } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		await onEdgesChange([{ type: 'select', id: 'c1', selected: true }])
		expect(edges.value[0]!.selected).toBe(true)
		expect(edges.value[0]!.markerEnd).toMatchObject({ type: 'arrow', color: '#2563eb' })

		// a props update (marker from the toolbar or another client) rebuilds
		// edges from the store — the selection must survive
		ws.connections_by_folder['/a'] = [
			conn({ id: 'c1', from: '/a/x', to: '/a/y', marker_end: 'arrow' }),
		]
		await nextTick()

		expect(edges.value[0]!.markerEnd).toMatchObject({
			type: 'arrow',
			width: 25,
			height: 25,
			markerUnits: 'userSpaceOnUse',
			color: '#2563eb',
		})
		expect(edges.value[0]!.selected).toBe(true)
	})

	test('does not write in read-only workspaces', async () => {
		const ws = makeWorkspace({ '/a': [] })
		ws.can_write = false
		const { onConnect, removeConnection } = setup(ws, '/a', ['/a/x', '/a/y'])
		await nextTick()

		await onConnect({ source: '/a/x', target: '/a/y', sourceHandle: null, targetHandle: null })
		await removeConnection('c1')
		expect(ws.upsert_connections).not.toHaveBeenCalled()
		expect(ws.delete_connections).not.toHaveBeenCalled()
	})
})

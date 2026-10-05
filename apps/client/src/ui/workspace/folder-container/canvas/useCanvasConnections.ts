import { shallowRef, watch, type ComputedRef } from 'vue'
import { MarkerType, type Connection as FlowConnection, type Edge, type EdgeChange, type EdgeMarker } from '@vue-flow/core'
import { applyEdgeChanges } from '@vue-flow/core'
import type { Connection, ConnectionMarker, FolderContainerWidget, HandlePosition } from '@/domain/Widget'
import {
	connection_key,
	make_connection_id,
} from '@/services/canvas/connections'
import { createId } from './drawing/createId'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

/**
 * The public `Edge` type omits `selected` (it lives on the internal
 * GraphEdge), but at runtime applyEdgeChanges writes it onto our plain edge
 * objects and Vue Flow reads it back when syncing v-model edges.
 */
export type CanvasEdge = Edge & { selected?: boolean }

function to_handle_position(value: string | null | undefined): HandlePosition | undefined {
	if (!value) return undefined

	const base = value.replace(/-(source|target)$/, '')
	if (base === 'top' || base === 'right' || base === 'bottom' || base === 'left') {
		return base
	}
	return undefined
}

function handle_id(position: HandlePosition | undefined, role: 'source' | 'target') {
	return position ? `${position}-${role}` : undefined
}

/** Matches Vue Flow's default 12.5 at selected stroke-width 2. */
const MARKER_SIZE = 25
const SELECTED_MARKER_COLOR = '#2563eb'

function to_vue_flow_marker(type: ConnectionMarker): MarkerType {
	return type === 'arrowclosed' ? MarkerType.ArrowClosed : MarkerType.Arrow
}

function to_edge_marker(
	type: ConnectionMarker | undefined,
	selected: boolean,
): EdgeMarker | undefined {
	if (!type) return undefined
	return {
		type: to_vue_flow_marker(type),
		width: MARKER_SIZE,
		height: MARKER_SIZE,
		markerUnits: 'userSpaceOnUse',
		...(selected ? { color: SELECTED_MARKER_COLOR } : {}),
	}
}

function marker_type(
	marker: Edge['markerStart'] | Edge['markerEnd'],
): ConnectionMarker | undefined {
	if (!marker) return undefined
	const type = typeof marker === 'string' ? marker : marker.type
	return type === 'arrow' || type === 'arrowclosed' ? type : undefined
}

function restyle_marker(
	marker: Edge['markerStart'] | Edge['markerEnd'],
	selected: boolean,
): EdgeMarker | undefined {
	return to_edge_marker(marker_type(marker), selected)
}

function with_marker_style(edge: CanvasEdge): CanvasEdge {
	const selected = Boolean(edge.selected)
	return {
		...edge,
		markerStart: restyle_marker(edge.markerStart, selected),
		markerEnd: restyle_marker(edge.markerEnd, selected),
	}
}

function connection_to_edge(connection: Connection, selected = false): CanvasEdge {
	return {
		id: connection.id,
		source: connection.from,
		target: connection.to,
		sourceHandle: handle_id(connection.from_handle, 'source'),
		targetHandle: handle_id(connection.to_handle, 'target'),
		animated: connection.is_animated,
		markerStart: to_edge_marker(connection.marker_start, selected),
		markerEnd: to_edge_marker(connection.marker_end, selected),
		type: 'labeled',
		label: connection.label,
		interactionWidth: 20,
		...(selected ? { selected: true } : {}),
	}
}

function flow_connection_to_domain(params: FlowConnection): Connection {
	const from_handle = to_handle_position(params.sourceHandle)
	const to_handle = to_handle_position(params.targetHandle)
	return {
		id: make_connection_id(params.source, params.target, from_handle, to_handle),
		from: params.source,
		to: params.target,
		from_handle,
		to_handle,
		is_animated: false,
	}
}

/**
 * Mirrors the workspace store's per-folder edges (`ws.connections_for`) into
 * local Vue Flow edges. Writes are discrete per-connection store calls
 * (connect / edge remove), so there is no whole-array persist or signature
 * machinery: remote events merge by connection id. Orphan edges (an endpoint
 * is not among the current children — e.g. it arrived before its widget in
 * multiplayer) stay in the store and are filtered out here at render time.
 */
export function useCanvasConnections(
	folderId: ComputedRef<string>,
	container: ComputedRef<FolderContainerWidget | null>,
) {
	const workspace = useWorkspace()
	// shallowRef: edges are replaced wholesale on every sync, never mutated
	const edges = shallowRef<CanvasEdge[]>([])
	/** Ids with a local write in flight — remote events for them keep the local edge. */
	const in_flight = new Set<string>()

	function visible_connections(): Connection[] {
		const ws = workspace.value
		if (!ws) return []
		const child_ids = new Set((container.value?.children ?? []).map(child => child.id))
		return ws.connections_for(folderId.value)
			.filter(connection => child_ids.has(connection.from) && child_ids.has(connection.to))
	}

	function syncFromStore() {
		const local_by_id = new Map<string, CanvasEdge>()
		for (const edge of edges.value) local_by_id.set(edge.id, edge)
		const next: CanvasEdge[] = []
		for (const connection of visible_connections()) {
			const local = local_by_id.get(connection.id)
			if (in_flight.has(connection.id)) {
				if (local) {
					next.push(local)
					continue
				}
			}
			const edge = connection_to_edge(connection, Boolean(local?.selected))
			next.push(edge)
		}
		edges.value = next
	}

	// Lazy load + live subscription; refires when the canvas switches folders.
	watch(
		() => [workspace.value, folderId.value] as const,
		([ws, id]) => {
			void ws?.ensure_connections(id)
		},
		{ immediate: true },
	)

	// The store replaces the folder's array on every apply, so identity watch
	// covers initial load, remote events, optimistic writes and folder switches.
	watch(
		() => workspace.value?.connections_for(folderId.value),
		syncFromStore,
		{ immediate: true },
	)

	// Children churn re-runs the orphan filter (widget arrived / went away).
	watch(
		() => container.value?.children,
		syncFromStore,
	)

	async function onConnect(params: FlowConnection) {
		if (!params.source || !params.target || params.source === params.target) {
			return
		}
		const ws = workspace.value
		if (!ws || !ws.can_write) return

		const current = ws.connections_for(folderId.value)
		const next = flow_connection_to_domain(params)

		if (current.some(c => connection_key(c) === connection_key(next))) {
			return
		}

		if (current.some(c => c.id === next.id)) {
			next.id = createId()
		}

		in_flight.add(next.id)
		try {
			await ws.upsert_connections(folderId.value, [next])
		} finally {
			in_flight.delete(next.id)
		}
	}

	async function onEdgesChange(changes: EdgeChange[]) {
		const removed_ids = changes
			.filter(change => change.type === 'remove')
			.map(change => change.id)

		// applyEdgeChanges expects internal GraphEdge[]; our plain CanvasEdge[]
		// works at runtime (same pattern as applyChangesCloned in useCanvasFlow).
		edges.value = applyEdgeChanges(changes, edges.value as never) as CanvasEdge[]
		if (changes.some(change => change.type === 'select')) {
			edges.value = edges.value.map(with_marker_style)
		}

		if (removed_ids.length === 0) {
			return
		}

		const ws = workspace.value
		if (!ws || !ws.can_write) return
		for (const id of removed_ids) in_flight.add(id)
		try {
			await ws.delete_connections(folderId.value, removed_ids)
		} finally {
			for (const id of removed_ids) in_flight.delete(id)
		}
	}

	function applyEdgeSelection(selectedIds: Set<string>) {
		let changed = false
		const next = edges.value.map((edge) => {
			const selected = selectedIds.has(edge.id)
			if (Boolean(edge.selected) === selected) return edge
			changed = true
			return with_marker_style({ ...edge, selected })
		})
		if (changed) edges.value = next
		return selectedIds.size > 0
	}

	function clearEdgeSelection() {
		applyEdgeSelection(new Set())
	}

	async function removeConnection(id: string) {
		const connection = workspace.value
			?.connections_for(folderId.value)
			.find(c => c.id === id)
		// EdgeRemoveChange carries the endpoints; removal itself matches by id
		const change: EdgeChange = {
			type: 'remove',
			id,
			source: connection?.from ?? '',
			target: connection?.to ?? '',
			sourceHandle: handle_id(connection?.from_handle, 'source') ?? null,
			targetHandle: handle_id(connection?.to_handle, 'target') ?? null,
		}
		await onEdgesChange([change])
	}

	return {
		edges,
		onConnect,
		onEdgesChange,
		applyEdgeSelection,
		clearEdgeSelection,
		removeConnection,
	}
}

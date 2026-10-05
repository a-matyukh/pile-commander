import { shallowRef, watch, type ComputedRef } from 'vue'
import type { StrokeNode } from '@/domain/Widget'
import {
	stroke_to_flow_node,
	flow_node_to_stroke,
	type FlowStrokeNode,
} from '@/services/canvas/strokes'
import { pointsToPath } from './drawing/strokePath'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

/**
 * Mirrors the workspace store's per-folder ink (`ws.strokes_for`) into local
 * Vue Flow nodes. Writes are discrete per-stroke store calls issued at the
 * moment of the gesture (pen commit / drag stop / eraser), so there is no
 * debounce or signature machinery: remote events merge by stroke id.
 */
export function useCanvasStrokes(
	folderId: ComputedRef<string>,
	options?: { isStrokeDragging?: ComputedRef<boolean> },
) {
	// shallowRef: stroke point arrays are large and immutable after creation;
	// deep reactivity over them is wasted work. All mutations replace the array.
	const workspace = useWorkspace()
	const strokeNodes = shallowRef<FlowStrokeNode[]>([])
	/** Ids with a local write in flight — remote events for them keep the local node. */
	const in_flight = new Set<string>()

	function toFlow(stroke: StrokeNode, selected: Set<string>): FlowStrokeNode {
		const node = stroke_to_flow_node(stroke)
		node.data.pathD = pointsToPath(node.data.points, node.data.strokeWidth)
		return selected.has(node.id) ? { ...node, selected: true } : node
	}

	function syncFromStore() {
		if (options?.isStrokeDragging?.value) return
		const ws = workspace.value
		if (!ws) return

		const selected = new Set(strokeNodes.value.filter(n => n.selected).map(n => n.id))
		const local_by_id = new Map(strokeNodes.value.map(n => [n.id, n]))
		const next: FlowStrokeNode[] = []
		for (const stroke of ws.strokes_for(folderId.value)) {
			if (in_flight.has(stroke.id)) {
				const local = local_by_id.get(stroke.id)
				if (local) next.push(local)
				continue
			}
			next.push(toFlow(stroke, selected))
		}
		strokeNodes.value = next
	}

	// Lazy load + live subscription; refires when the canvas switches folders.
	watch(
		() => [workspace.value, folderId.value] as const,
		([ws, id]) => {
			void ws?.ensure_strokes(id)
		},
		{ immediate: true },
	)

	// The store replaces the folder's array on every apply, so identity watch
	// covers initial load, remote events, optimistic writes and folder switches.
	watch(
		() => workspace.value?.strokes_for(folderId.value),
		syncFromStore,
		{ immediate: true },
	)

	function nextStrokeZ(): number {
		return strokeNodes.value.reduce((max, node) => Math.max(max, node.z), 0) + 1
	}

	/** Pen commit: the drawing layer already appended the node — persist it. */
	function onStrokeCommit(node: FlowStrokeNode) {
		const ws = workspace.value
		if (!ws || !ws.can_write) return
		in_flight.add(node.id)
		void ws.upsert_strokes(folderId.value, [flow_node_to_stroke(node)])
			.finally(() => in_flight.delete(node.id))
	}

	/** Drag stop: persist only the dragged strokes (positions changed, z kept). */
	async function persistStrokes(ids: string[]) {
		const ws = workspace.value
		if (!ws || !ws.can_write) return
		const by_id = new Map(strokeNodes.value.map(n => [n.id, n]))
		const strokes = ids
			.map(id => by_id.get(id))
			.filter((n): n is FlowStrokeNode => Boolean(n))
			.map(flow_node_to_stroke)
		if (strokes.length === 0) return
		for (const stroke of strokes) in_flight.add(stroke.id)
		try {
			await ws.upsert_strokes(folderId.value, strokes)
		} finally {
			for (const stroke of strokes) in_flight.delete(stroke.id)
		}
	}

	/** Eraser / delete-selected: local removal is done by the caller. */
	async function deleteStrokes(ids: string[]) {
		const ws = workspace.value
		if (!ws || !ws.can_write || ids.length === 0) return
		for (const id of ids) in_flight.add(id)
		try {
			await ws.delete_strokes(folderId.value, ids)
		} finally {
			for (const id of ids) in_flight.delete(id)
		}
	}

	return {
		strokeNodes,
		nextStrokeZ,
		onStrokeCommit,
		persistStrokes,
		deleteStrokes,
	}
}

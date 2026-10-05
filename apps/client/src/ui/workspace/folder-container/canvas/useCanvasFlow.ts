import {
	applyNodeChanges,
	type NodeChange,
	type NodeRemoveChange,
} from '@vue-flow/core'
import { computed, markRaw, watch, type ComputedRef, type Ref } from 'vue'
import type { BoardSnapSettings } from '@/services/board/layout'
import type { FlowStrokeNode } from '@/services/canvas/strokes'
import CanvasLabeledEdge from './CanvasLabeledEdge.vue'
import CanvasWidgetNode from './CanvasWidgetNode.vue'
import StrokeNode from './drawing/StrokeNode.vue'
import type { EditorTool } from './drawing/types'
import type { CanvasFlowNode } from './useCanvasNodes'
import { useCanvasToolFlags } from './useCanvasToolFlags'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

/**
 * Structural stand-in for vue-flow's `Edge`: using the real type here trips
 * TS2589 (excessively deep instantiation) via the `v-model:edges` binding.
 */
export type FlowEdgeLike = {
	id: string
	source: string
	target: string
	[key: string]: unknown
}

/**
 * Applies vue-flow node changes to a plain-node array.
 * applyNodeChanges mutates and returns the same array; callers keep nodes in a
 * shallowRef, so a fresh array is returned to trigger reactivity. The `never`
 * cast avoids vue-flow `Node<>` deep type instantiation on our plain objects.
 */
function applyChangesCloned<T>(changes: NodeChange[], nodes: T[]): T[] {
	return [...applyNodeChanges(changes, nodes as never)] as T[]
}

export function useCanvasFlow(options: {
	widgetNodes: Ref<CanvasFlowNode[]>
	strokeNodes: Ref<FlowStrokeNode[]>
	edges: Ref<FlowEdgeLike[]>
	editingNoteId: Ref<string | null>
	tool: Ref<EditorTool>
	boardSnapSettings: ComputedRef<BoardSnapSettings>
	/** Persist Vue Flow keyboard-delete of strokes (toolbar/eraser call this themselves). */
	deleteStrokes: (ids: string[]) => Promise<void>
}) {
	const {
		widgetNodes,
		strokeNodes,
		edges,
		editingNoteId,
		tool,
		boardSnapSettings,
		deleteStrokes,
	} = options

	const nodeTypes = {
		folderWidget: markRaw(CanvasWidgetNode),
		stroke: markRaw(StrokeNode),
	}

	const edgeTypes = {
		labeled: markRaw(CanvasLabeledEdge),
	}

	const toolFlags = useCanvasToolFlags(tool, boardSnapSettings)
	const { isSelectTool, isHandTool } = toolFlags
	const workspace = useWorkspace()
	const can_write = computed(() => workspace.value?.can_write !== false)

	const selectedStrokeCount = computed(() =>
		strokeNodes.value.filter(n => n.selected).length,
	)

	const selectedWidgetCount = computed(() =>
		widgetNodes.value.filter(n => n.selected).length,
	)

	/** Avoid vue-flow `Node<>` deep instantiation (same pattern as CanvasFlowNode). */
	const flowNodes = computed(() => {
		const strokes = strokeNodes.value.map(node => ({
			...node,
			draggable: isSelectTool.value && can_write.value,
			selectable: isSelectTool.value,
		}))
		const widgets = widgetNodes.value.map(node => ({
			...node,
			// per-node draggable overrides the global nodes-draggable — gate the
			// read-only case here or viewers could drag widgets (drop → persist throws)
			draggable:
				(isHandTool.value || isSelectTool.value)
				&& editingNoteId.value !== node.id
				&& can_write.value,
			selectable: isSelectTool.value,
		}))
		return [...strokes, ...widgets]
	})

	const flowEdges = computed({
		get: () => edges.value,
		set: (value) => {
			edges.value = value
		},
	})

	function strokeSelectionChanges(selectedIds: Set<string>): NodeChange[] {
		return strokeNodes.value.map(node => ({
			id: node.id,
			type: 'select',
			selected: selectedIds.has(node.id),
		}))
	}

	/** Applies selection (empty set deselects all). Returns true when anything is selected. */
	function applyStrokeSelection(selectedIds: Set<string>): boolean {
		if (selectedIds.size === 0) {
			clearStrokeSelection()
			return false
		}

		strokeNodes.value = applyChangesCloned(
			strokeSelectionChanges(selectedIds),
			strokeNodes.value,
		)
		return true
	}

	function clearStrokeSelection() {
		if (!strokeNodes.value.some(n => n.selected)) return
		strokeNodes.value = applyChangesCloned(
			strokeSelectionChanges(new Set()),
			strokeNodes.value,
		)
	}

	function applyWidgetSelection(selectedIds: Set<string>): boolean {
		let changed = false
		const next = widgetNodes.value.map((node) => {
			const selected = selectedIds.has(node.id)
			if (Boolean(node.selected) === selected) return node
			changed = true
			return { ...node, selected }
		})
		if (changed) widgetNodes.value = next
		syncWidgetSelectionToWorkspace()
		return selectedIds.size > 0
	}

	function clearWidgetNodeSelection() {
		if (!widgetNodes.value.some(n => n.selected)) return
		widgetNodes.value = widgetNodes.value.map(node =>
			node.selected ? { ...node, selected: false } : node,
		)
	}

	function syncWidgetSelectionToWorkspace() {
		const ws = workspace.value
		if (!ws) return
		const selectedIds = widgetNodes.value
			.filter(node => node.selected)
			.map(node => node.id)
		ws.set_selection(selectedIds)
	}

	/**
	 * Chrome Select / shell clicks write workspace.selection; Vue Flow multi-drag
	 * reads node.selected. Keep widgetNodes.selected in sync so getDragItems
	 * includes the whole group even when the selection tool is not active.
	 */
	watch(
		() => workspace.value?.selection.slice() ?? [],
		(selectedIds) => {
			const selectedSet = new Set(selectedIds)
			let changed = false
			const next = widgetNodes.value.map((node) => {
				const selected = selectedSet.has(node.id)
				if (Boolean(node.selected) === selected) return node
				changed = true
				return { ...node, selected }
			})
			if (changed) {
				widgetNodes.value = next
			}
		},
	)

	function onNodesChange(changes: NodeChange[]) {
		// Position/dimension changes are no-ops for our plain node objects
		// (vue-flow's applyChanges only applies them to graph nodes with
		// `computedPosition`), so filter them out. This keeps the source arrays
		// untouched during drags — no flowNodes churn per pointermove. Final
		// positions are synced explicitly on drag stop.
		const relevant = changes.filter(c => c.type === 'select' || c.type === 'add' || c.type === 'remove')
		if (relevant.length === 0) return

		const strokeIds = new Set(strokeNodes.value.map(n => n.id))

		// Stroke lifecycle is owned by strokeNodes (draw / eraser / toolbar).
		// Vue Flow keyboard-delete emits remove changes while select is active:
		// apply them locally and persist. Toolbar/eraser already dropped the
		// nodes from strokeNodes, so those remove events are ignored here.
		const strokeSelects = relevant.filter(
			c => c.type === 'select' && 'id' in c && strokeIds.has(c.id),
		)
		const strokeRemoves = isSelectTool.value
			? relevant.filter((c): c is NodeRemoveChange =>
				c.type === 'remove' && strokeIds.has(c.id),
			)
			: []
		const strokeChanges = [...strokeSelects, ...strokeRemoves]

		// Widget removes must go through workspace (BulkRemoveDialog), never Vue Flow.
		const widgetChanges = relevant.filter(
			c =>
				'id' in c
				&& !strokeIds.has(c.id)
				&& c.type !== 'remove',
		)

		if (strokeChanges.length > 0) {
			strokeNodes.value = applyChangesCloned(strokeChanges, strokeNodes.value)
			const removedIds = strokeRemoves.map(change => change.id)
			if (removedIds.length > 0) {
				void deleteStrokes(removedIds)
			}
		}

		if (widgetChanges.length > 0) {
			widgetNodes.value = applyChangesCloned(widgetChanges, widgetNodes.value)
			if (widgetChanges.some(c => c.type === 'select')) {
				syncWidgetSelectionToWorkspace()
			}
		}
	}

	function setNodePosition<T extends { id: string; position: { x: number; y: number } }>(
		nodesRef: Ref<T[]>,
		nodeId: string,
		position: { x: number; y: number },
	) {
		const index = nodesRef.value.findIndex(node => node.id === nodeId)
		if (index === -1) return
		const next = [...nodesRef.value]
		next[index] = { ...next[index], position: { x: position.x, y: position.y } }
		nodesRef.value = next
	}

	function setStrokePosition(nodeId: string, position: { x: number; y: number }) {
		setNodePosition(strokeNodes, nodeId, position)
	}

	function setWidgetPosition(nodeId: string, position: { x: number; y: number }) {
		setNodePosition(widgetNodes, nodeId, position)
	}

	return {
		nodeTypes,
		edgeTypes,
		flowNodes,
		flowEdges,
		...toolFlags,
		selectedStrokeCount,
		selectedWidgetCount,
		applyStrokeSelection,
		applyWidgetSelection,
		clearStrokeSelection,
		clearWidgetNodeSelection,
		onNodesChange,
		setStrokePosition,
		setWidgetPosition,
	}
}

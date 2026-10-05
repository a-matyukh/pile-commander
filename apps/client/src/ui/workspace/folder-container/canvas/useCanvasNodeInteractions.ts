import type { ComputedRef, Ref } from 'vue'
import type { EdgeMouseEvent, GraphNode, NodeDragEvent, NodeMouseEvent } from '@vue-flow/core'
import type { Position } from '@/domain/Widget'
import { findDropFolder } from '../folderDrop'
import {
	snapshotWidgetDragPositions,
	type CanvasDragPositionSnapshot,
} from './canvasDragPersist'
import type { EditorTool } from './drawing/types'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

type UseCanvasNodeInteractionsOptions = {
	tool: Ref<EditorTool>
	hoveredNodeId: Ref<string | null>
	/** Created by the view before node sync composables, which pause on them. */
	isStrokeDragging: Ref<boolean>
	isWidgetDragging: Ref<boolean>
	setStrokePosition: (nodeId: string, position: Position) => void
	setWidgetPosition: (nodeId: string, position: Position) => void
	/** Persist the given strokes after a drag stop (positions changed). */
	persistStrokes: (ids: string[]) => Promise<void>
	/** Persist stroke deletions (eraser click / delete-selected). */
	deleteStrokes: (ids: string[]) => Promise<void>
	onWidgetDragStop: (
		event: NodeDragEvent,
		snapshots: CanvasDragPositionSnapshot[],
	) => Promise<void>
	removeStrokeNode: (id: string) => void
	removeConnection: (id: string) => Promise<void>
	/** Selected stroke ids from local strokeNodes (lasso + select). */
	selectedStrokeIds: ComputedRef<string[]>
	removeNodes: (nodes: string[] | GraphNode[]) => void
}

function findBoardWidgetElement(
	widgetId: string,
	eventTarget?: EventTarget | null,
): HTMLElement | null {
	const selector = `.board-widget[data-id="${CSS.escape(widgetId)}"]`
	const scope = eventTarget instanceof Element
		? eventTarget.closest('section[data-path]')
		: null
	return (
		scope?.querySelector<HTMLElement>(selector)
		?? document.querySelector<HTMLElement>(selector)
	)
}

/** Node-level event handlers for the canvas: drag sync, eraser clicks, hover highlight. */
export function useCanvasNodeInteractions(options: UseCanvasNodeInteractionsOptions) {
	const { tool, hoveredNodeId, isStrokeDragging, isWidgetDragging } = options
	const workspace = useWorkspace()
	let highlightedFolder: HTMLElement | null = null

	function clearFolderHighlight() {
		highlightedFolder?.classList.remove('drop-target')
		highlightedFolder = null
	}

	function onNodeDragStart(event: NodeDragEvent) {
		const dragged = event.nodes.length > 0 ? event.nodes : [event.node]
		if (dragged.some(node => node.type === 'stroke')) {
			isStrokeDragging.value = true
		}
		if (dragged.some(node => node.type !== 'stroke')) {
			isWidgetDragging.value = true
		}
	}

	function onNodeDrag(event: NodeDragEvent) {
		if (event.node.type === 'stroke') return

		const el = findBoardWidgetElement(event.node.id, event.event.target)
		if (!el) {
			clearFolderHighlight()
			return
		}

		const folder = findDropFolder(el)
		if (folder !== highlightedFolder) {
			clearFolderHighlight()
			highlightedFolder = folder
			folder?.classList.add('drop-target')
		}
	}

	async function onNodeDragStop(event: NodeDragEvent) {
		clearFolderHighlight()

		// Positions are not echoed back per frame (see onNodesChange), so sync all
		// dragged nodes here — event.nodes covers multi-select drags.
		const dragged = event.nodes.length > 0 ? event.nodes : [event.node]

		const dragged_stroke_ids: string[] = []
		for (const node of dragged) {
			if (node.type === 'stroke') {
				options.setStrokePosition(node.id, {
					x: node.position.x,
					y: node.position.y,
				})
				dragged_stroke_ids.push(node.id)
			}
		}

		// Snapshot before awaits: VF setNodes can Object.assign-mutate live
		// GraphNode refs while we still have sequential change_position calls.
		const snapshots = snapshotWidgetDragPositions(dragged)
		for (const snapshot of snapshots) {
			options.setWidgetPosition(snapshot.id, snapshot.position)
		}

		try {
			if (dragged_stroke_ids.length > 0) {
				await options.persistStrokes(dragged_stroke_ids)
			}
			if (snapshots.length > 0) {
				await options.onWidgetDragStop(event, snapshots)
			}
		} finally {
			isStrokeDragging.value = false
			isWidgetDragging.value = false
		}
	}

	function onNodeClick(event: NodeMouseEvent) {
		if (tool.value === 'eraser' && event.node.type === 'stroke') {
			options.removeStrokeNode(event.node.id)
			options.removeNodes([event.node.id])
			void options.deleteStrokes([event.node.id])
		}
	}

	function onNodeMouseEnter(event: NodeMouseEvent) {
		if (event.node.type !== 'stroke') return
		if (tool.value === 'select' || tool.value === 'eraser') {
			hoveredNodeId.value = event.node.id
		}
	}

	function onNodeMouseLeave(event: NodeMouseEvent) {
		if (hoveredNodeId.value === event.node.id) {
			hoveredNodeId.value = null
		}
	}

	function onEdgeClick(event: EdgeMouseEvent) {
		if (tool.value !== 'disconnect') return
		void options.removeConnection(event.edge.id)
	}

	function deleteSelectedStrokes() {
		if (workspace.value?.can_write === false) return

		const ids = options.selectedStrokeIds.value
		if (ids.length === 0) return

		for (const id of ids) {
			options.removeStrokeNode(id)
		}
		options.removeNodes(ids)
		void options.deleteStrokes(ids)
	}

	return {
		onNodeDragStart,
		onNodeDrag,
		onNodeDragStop,
		onNodeClick,
		onNodeMouseEnter,
		onNodeMouseLeave,
		onEdgeClick,
		deleteSelectedStrokes,
	}
}

import { ref, watch, type ComputedRef, type Ref } from 'vue'
import type { NodeDragEvent } from '@vue-flow/core'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import type { FolderContainerWidget, FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import { board_position, board_size } from '@/services/board/layout'
import { applyGroupResizeDelta } from '../board/boardGroupResize'
import { relativePositionsForFolderDrop } from '../board/boardGroupDrag'
import { tryDropOnFolder, type FolderDropOptions } from '../folderDrop'
import {
	persistDragPositionSnapshots,
	type CanvasDragPositionSnapshot,
} from './canvasDragPersist'

export type CanvasNodeData = {
	widget: FolderContainerWidgetChild
	index: number
}

/** Local node shape — avoids vue-flow `Node<>` deep instantiation with motion-v. */
export type CanvasFlowNode = {
	id: string
	type: 'folderWidget'
	position: Position
	draggable: boolean
	selected?: boolean
	data: CanvasNodeData
	style: Record<string, string>
}

function nodeStyle(widget: FolderContainerWidgetChild) {
	const size = board_size(widget)
	return {
		width: `${size.width}px`,
		height: `${size.height}px`,
	}
}

function childSignature(children: FolderContainerWidgetChild[]) {
	return children.map((child) => {
		const size = board_size(child)
		const pos = child.position
		return [
			child.id,
			pos?.x ?? '',
			pos?.y ?? '',
			size.width,
			size.height,
			child.name,
			child.type,
			child.background ?? '',
			child.is_preview ?? '',
		].join(':')
	}).join('|')
}

export function useCanvasNodes(
	container: ComputedRef<FolderContainerWidget | null>,
	editingNoteId: Ref<string | null>,
	options?: { isWidgetDragging?: ComputedRef<boolean> },
) {
	const requireWorkspace = useRequireWorkspace()
	const nodes = ref<CanvasFlowNode[]>([])

	// the node being resized and the selection resized along with it
	let resizeGroup: {
		primaryId: string
		primaryStart: Size
		memberStarts: Record<string, Size>
	} | null = null

	function isBeingResized(id: string) {
		return !!resizeGroup && (resizeGroup.primaryId === id || id in resizeGroup.memberStarts)
	}

	function getNodePosition(id: string) {
		const node = nodes.value.find(n => n.id === id)
		return node?.position
	}

	function syncNodes() {
		if (options?.isWidgetDragging?.value) return

		const children = container.value?.children ?? []
		const prevById = new Map(nodes.value.map(node => [node.id, node]))

		nodes.value = children.map((widget, index) => {
			const prev = prevById.get(widget.id)
			return {
				id: widget.id,
				type: 'folderWidget' as const,
				position: board_position(widget, index),
				draggable: editingNoteId.value !== widget.id,
				// Vue Flow NodeProps.selected is Boolean — undefined triggers prop warnings.
				selected: prev?.selected ?? false,
				data: { widget, index },
				// the stored size, so a size set elsewhere (another tab, a
				// collaborator, folder sync) shows at once; a node under the
				// person's resize handle keeps its live size
				style: prev && isBeingResized(widget.id) ? prev.style : nodeStyle(widget),
			}
		})
	}

	watch(
		() => childSignature(container.value?.children ?? []),
		syncNodes,
		{ immediate: true },
	)

	// childSignature may change during drag (e.g. folder drop) while sync is paused;
	// flush once the gesture ends so removed widgets leave the flow.
	if (options?.isWidgetDragging) {
		watch(
			() => options.isWidgetDragging!.value,
			(dragging, wasDragging) => {
				if (wasDragging && !dragging) syncNodes()
			},
		)
	}

	async function onNodeDragStop(
		event: NodeDragEvent,
		snapshots: CanvasDragPositionSnapshot[],
	) {
		const dropIds = snapshots.map(snapshot => snapshot.id)
		// Must use the primary dragged widget — mouseup target is often the folder
		// under the cursor, and findDropFolder would skip it as `folder === dragged`.
		const primaryId = event.node.id
		const eventTarget = event.event.target
		const scope = eventTarget instanceof Element
			? eventTarget.closest('section[data-path]')
			: null
		const widgetElement = (
			scope?.querySelector<HTMLElement>(
				`.board-widget[data-id="${CSS.escape(primaryId)}"]`,
			)
			?? document.querySelector<HTMLElement>(
				`.board-widget[data-id="${CSS.escape(primaryId)}"]`,
			)
		)

		if (widgetElement) {
			const primarySnap = snapshots.find(s => s.id === primaryId)?.position
				?? getNodePosition(primaryId)
			const memberStarts: Record<string, Position> = {}
			for (const snapshot of snapshots) {
				memberStarts[snapshot.id] = { ...snapshot.position }
			}
			let cachedRelativeById: Record<string, Position> | null = null

			const dropOptions: FolderDropOptions = {
				getWorkspace: requireWorkspace,
				resolveRelativePosition(_dragged, folder, widgetId) {
					if (!cachedRelativeById) {
						const folderPos = getNodePosition(folder.dataset.id ?? '')
						if (!primarySnap || !folderPos) {
							cachedRelativeById = {}
							return null
						}
						cachedRelativeById = relativePositionsForFolderDrop(
							primaryId,
							{
								x: primarySnap.x - folderPos.x,
								y: primarySnap.y - folderPos.y,
							},
							memberStarts,
						)
					}
					return cachedRelativeById[widgetId] ?? null
				},
			}

			if (await tryDropOnFolder(widgetElement, dropIds, dropOptions)) {
				return
			}
		}

		const ws = requireWorkspace()
		await persistDragPositionSnapshots(snapshots, (id, position) =>
			ws.change_position(id, position),
		)
	}

	/** Matches NodeResizer min-width/min-height in CanvasWidgetNode. */
	const minNodeSize: Size = { width: 100, height: 50 }

	/** Line shapes resize via endpoint handles, not NodeResizer — skip them. */
	function isLineNode(id: string) {
		return !!document.querySelector(
			`.vue-flow__node[data-id="${CSS.escape(id)}"] .canvas-widget-node--line`,
		)
	}

	function onNodeResizeStart(nodeId: string, size: Size) {
		resizeGroup = {
			primaryId: nodeId,
			primaryStart: { ...size },
			memberStarts: {},
		}

		const ws = requireWorkspace()
		if (!ws.is_selected(nodeId)) return

		const children = container.value?.children ?? []
		const childById = new Map(children.map(child => [child.id, child] as const))
		const selectedInFolder = ws.selection.filter(id => childById.has(id))
		if (selectedInFolder.length < 2 || !selectedInFolder.includes(nodeId)) return

		for (const id of selectedInFolder) {
			if (id === nodeId || isLineNode(id)) continue
			resizeGroup.memberStarts[id] = { ...board_size(childById.get(id)!) }
		}
	}

	function groupSizes(finalPrimarySize: Size) {
		if (!resizeGroup) return {}
		const delta = {
			width: finalPrimarySize.width - resizeGroup.primaryStart.width,
			height: finalPrimarySize.height - resizeGroup.primaryStart.height,
		}
		return applyGroupResizeDelta(resizeGroup.memberStarts, delta, minNodeSize)
	}

	function onNodeResizeLive(nodeId: string, size: Size) {
		// Node style pins width/height — without this the resized node itself
		// only catches up at resize-end while companions follow live.
		const primaryNode = nodes.value.find(n => n.id === nodeId)
		if (primaryNode) {
			primaryNode.style = {
				width: `${size.width}px`,
				height: `${size.height}px`,
			}
		}

		if (!resizeGroup || resizeGroup.primaryId !== nodeId) return
		for (const [memberId, memberSize] of Object.entries(groupSizes(size))) {
			const node = nodes.value.find(n => n.id === memberId)
			if (node) {
				node.style = {
					width: `${memberSize.width}px`,
					height: `${memberSize.height}px`,
				}
			}
		}
	}

	async function onNodeResizeEnd(nodeId: string, size: Size) {
		const node = nodes.value.find(n => n.id === nodeId)
		if (node) {
			node.style = {
				width: `${size.width}px`,
				height: `${size.height}px`,
			}
		}
		const memberSizes = resizeGroup?.primaryId === nodeId ? groupSizes(size) : {}
		resizeGroup = null

		const ws = requireWorkspace()
		await ws.change_size(nodeId, size)
		for (const [memberId, memberSize] of Object.entries(memberSizes)) {
			await ws.change_size(memberId, memberSize)
		}
	}

	function applyLineGeometryLive(
		nodeId: string,
		geometry: { position: Position; size: Size },
	) {
		const index = nodes.value.findIndex(n => n.id === nodeId)
		if (index === -1) return
		const node = nodes.value[index]!
		const next = [...nodes.value]
		next[index] = {
			...node,
			position: { ...geometry.position },
			style: {
				width: `${geometry.size.width}px`,
				height: `${geometry.size.height}px`,
			},
		}
		nodes.value = next
	}

	return {
		nodes,
		onNodeDragStop,
		onNodeResizeStart,
		onNodeResizeLive,
		onNodeResizeEnd,
		applyLineGeometryLive,
	}
}

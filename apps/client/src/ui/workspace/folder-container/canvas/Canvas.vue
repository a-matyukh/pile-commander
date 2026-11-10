<script setup lang="ts">
import {
	useVueFlow,
	VueFlow,
	SelectionMode,
	type VueFlowStore,
	type EdgeMouseEvent,
	type NodeDragEvent,
} from '@vue-flow/core'
import { computed, nextTick, onMounted, onUnmounted, provide, ref, watch, type ComponentPublicInstance, type Ref } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { Background } from '@vue-flow/background'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/node-resizer/dist/style.css'
import type { Connection, Position } from '@/domain/Widget'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { useBoardSnapSettings } from '../useBoardSnapSettings'
import {
	widgetLayoutModeKey,
	boardSnapSettingsKey,
	canvasNodeResizeKey,
	canvasLineGeometryKey,
	canvasEditorToolKey,
	canvasZoomKey,
	canvasEdgeLabelEditKey,
} from '../injectKeys'
import { provideEditingNoteId } from '../widgets/useEditingNoteId'
import { useFolderPaneActions } from '../useFolderPaneActions'
import FolderContainerCtxMenu from '@/ui/workspace/menu/FolderContainerCtxMenu.vue'
import CanvasDrawingToolbar from './CanvasDrawingToolbar.vue'
import CanvasDock from './dock/CanvasDock.vue'
import type { DockZoomAction } from './dock/canvasDockItems'
import { default_canvas_tool } from './canvasDefaultTool'
import { useCanvasSpacePan } from './useCanvasSpacePan'
import { nextCanvasFlowId } from './canvasFlowId'
import { useCanvasNodes } from './useCanvasNodes'
import { useCanvasConnections } from './useCanvasConnections'
import { useCanvasStrokes } from './useCanvasStrokes'
import { useCanvasFlow, type FlowEdgeLike } from './useCanvasFlow'
import {
	draggedNodeParticipatesInGroup,
	lockSoloDrag,
	restoreDraggable,
	type DraggableSnapshot,
} from './canvasSoloDrag'
import { useCanvasToolState } from './useCanvasToolState'
import { useCanvasToolShortcuts } from './useCanvasToolShortcuts'
import { useCanvasGestures } from './useCanvasGestures'
import { useCanvasNodeInteractions } from './useCanvasNodeInteractions'
import { useCanvasMarqueeEdges } from './useCanvasMarqueeEdges'
import { useMoveSelectedWidgets } from '../useMoveSelectedWidgets'
import DrawingPreview from './drawing/DrawingPreview.vue'
import LassoPreview from './drawing/LassoPreview.vue'
import LineDrawPreview from './drawing/LineDrawPreview.vue'
import EmptyPaneHint from '../EmptyPaneHint.vue'
import { useLineDrawMode } from '../useLineDrawMode'
import { useTextPlaceMode } from '../useTextPlaceMode'
import CanvasAxes from './CanvasAxes.vue'
import { backgroundStyle, defaultViewBackground } from '../widgets/resolveBackground'
import PileImagePending from '../widgets/PileImagePending.vue'
import { useResolvedFill } from '../widgets/useResolvedFill'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { t } from '@/i18n'
import { history, record_action } from '@/store/history'
import { setExternalDropPositionResolver } from '../externalDropPosition'
import {
	registerPaneEditingNoteSetter,
	registerPanePositionResolver,
} from '../panePosition'
import type { BoardViewport } from './drawing/types'
import { ZOOM_MAX, ZOOM_MIN, type EditorTool } from './drawing/types'
import { PEN_CURSOR } from './drawing/cursors'
import { isCanvasToolAllowed, useCanvasToolbarPrefs } from './useCanvasToolbarPrefs'
import { clearCanvasToolbarInset, setCanvasToolbarInset } from './canvasToolbarInset'
import { useHoverClickMenu } from './useHoverClickMenu'
import { useRevealEditingNote } from '../revealEditingNote'

const { folderId, container, isEmbedded } = useFolderContainerScope()
const isMdUp = useMediaQuery('(min-width: 768px)')
const toolbarCompact = computed(() => isEmbedded || !isMdUp.value)
const toolbarPrefs = useCanvasToolbarPrefs()

// Its own Vue Flow store: a nested folder preview never shares its parent's
const flowId = nextCanvasFlowId()

provide(widgetLayoutModeKey, 'canvas')

const editingNoteId = ref<string | null>(null)
const editingEdgeId = ref<string | null>(null)
const flowStore = ref<VueFlowStore | null>(null)
const flowWrapper = ref<HTMLElement | null>(null)
const paneEl = ref<HTMLElement | null>(null)

const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)
const isCoarsePointer = useMediaQuery('(pointer: coarse)')

/** The tool this canvas opens with, and comes back to when its toolbar is shown again */
function defaultTool(): EditorTool {
	return default_canvas_tool({
		can_write: can_write.value,
		hidden: toolbarPrefs.value.hidden,
		embedded: isEmbedded,
		coarse: isCoarsePointer.value,
	})
}

const { tool, penColor, penWidth, hoveredNodeId } = useCanvasToolState(defaultTool())

const { held: spaceHeld } = useCanvasSpacePan({
	enabled: () => !isEmbedded && !toolbarPrefs.value.hidden,
	area: flowWrapper,
})
/** Space is held and there is a tool to step away from: a drag moves the canvas */
const spacePan = computed(() => spaceHeld.value && tool.value !== 'hand')
/**
 * The tool at work: Hand while Space is held. `tool` stays the person's
 * choice, so what a change of tool resets (the selection) is left alone.
 */
const activeTool = computed<EditorTool>(() => (spacePan.value ? 'hand' : tool.value))

const toolbarHost = ref<ComponentPublicInstance | null>(null)

function toolbarElement(): HTMLElement | null {
	const el = toolbarHost.value?.$el
	return el instanceof HTMLElement ? el : null
}

function publishToolbarInset() {
	const id = folderId.value
	const onTop = toolbarPrefs.value.classic
		&& toolbarPrefs.value.side === 'top'
		&& !toolbarPrefs.value.hidden
		&& can_write.value
	const el = toolbarElement()
	if (!onTop || !el) {
		setCanvasToolbarInset(id, 0)
		return
	}
	setCanvasToolbarInset(id, el.offsetHeight)
}

watch(toolbarHost, (host, _, onCleanup) => {
	const el = host?.$el
	if (!(el instanceof HTMLElement)) return
	const observer = new ResizeObserver(() => publishToolbarInset())
	observer.observe(el)
	publishToolbarInset()
	onCleanup(() => observer.disconnect())
}, { flush: 'post' })

watch(
	() => [toolbarPrefs.value.side, toolbarPrefs.value.hidden, can_write.value, folderId.value, toolbarPrefs.value.classic] as const,
	(current, previous) => {
		const prevId = previous?.[3]
		if (prevId && prevId !== current[3]) clearCanvasToolbarInset(prevId)
		publishToolbarInset()
	},
)

onUnmounted(() => clearCanvasToolbarInset(folderId.value))

/** Read-only access keeps viewing tools (hand/select) but blocks mutating ones. */
const READONLY_BLOCKED_TOOLS = new Set<EditorTool>(['pen', 'eraser', 'lasso', 'connect', 'disconnect'])
/** Drawing / disconnect: double-click should not open the edge-label input. */
const EDGE_LABEL_BLOCKED_TOOLS = new Set<EditorTool>(['disconnect', 'pen', 'eraser', 'lasso'])
function on_tool_update(next: EditorTool) {
	if (!isCanvasToolAllowed(next, toolbarPrefs.value.hidden)) return
	if (!can_write.value && READONLY_BLOCKED_TOOLS.has(next)) return
	tool.value = next
}

watch(
	() => toolbarPrefs.value.hidden,
	(hidden) => {
		// Hidden is always Hand; shown again, the canvas is as it opens
		tool.value = hidden ? 'hand' : defaultTool()
	},
)

useCanvasToolShortcuts({
	enabled: () => !isEmbedded,
	editingNoteId,
	setTool: on_tool_update,
})

const isCanvasEmpty = computed(() => {
	const folder = container.value
	if (!folder) return false
	return folder.children.length === 0
		&& (workspace.value?.strokes_for(folderId.value).length ?? 0) === 0
		&& (workspace.value?.connections_for(folderId.value).length ?? 0) === 0
})

const boardSnapSettings = useBoardSnapSettings()

useMoveSelectedWidgets({
	children: computed(() => container.value?.children ?? []),
	editingNoteId,
	boardSnapSettings,
	enabled: () => !isEmbedded,
})

provideEditingNoteId(editingNoteId)
provide(boardSnapSettingsKey, boardSnapSettings)
provide(canvasEditorToolKey, activeTool)

const showGridDots = computed(() => container.value?.show_grid_dots ?? true)
const showAxes = computed(() => container.value?.show_axes ?? false)

const isStrokeDragging = ref(false)
const isWidgetDragging = ref(false)

const {
	nodes: widgetNodes,
	onNodeDragStop: onWidgetDragStop,
	onNodeResizeStart,
	onNodeResizeLive,
	onNodeResizeEnd,
	onTextResizeLive,
	onTextResizeEnd,
	applyLineGeometryLive,
} = useCanvasNodes(container, editingNoteId, {
	isWidgetDragging: computed(() => isWidgetDragging.value),
})

const {
	strokeNodes,
	nextStrokeZ,
	onStrokeCommit,
	persistStrokes,
	deleteStrokes,
} = useCanvasStrokes(folderId, {
	isStrokeDragging: computed(() => isStrokeDragging.value),
})

const {
	edges,
	onConnect,
	onEdgesChange,
	applyEdgeSelection,
	clearEdgeSelection,
	removeConnection,
} = useCanvasConnections(folderId, container)

/** The edge under the props toolbar: exactly one selected edge → its connection. */
const selectedConnection = computed<Connection | null>(() => {
	const selected = edges.value.filter(edge => edge.selected)
	if (selected.length !== 1) return null
	const ws = workspace.value
	if (!ws) return null
	return ws.connections_for(folderId.value).find(c => c.id === selected[0]!.id) ?? null
})

async function on_update_connection(patch: Partial<Pick<Connection, 'marker_start' | 'marker_end' | 'is_animated'>>) {
	const ws = workspace.value
	const connection = selectedConnection.value
	if (!ws || !ws.can_write || !connection) return
	const folder_id = folderId.value
	await record_action(ws, { folder_id }, t('undo.arrow'), tx =>
		ws.upsert_connections(folder_id, [{ ...connection, ...patch }], { tx }))
}

async function on_delete_connection() {
	const edge = edges.value.find(e => e.selected)
	if (!edge || !can_write.value) return
	await removeConnection(edge.id)
}

function beginEdgeLabelEdit(edgeId: string) {
	if (!can_write.value) return
	if (EDGE_LABEL_BLOCKED_TOOLS.has(tool.value)) return
	applyEdgeSelection(new Set([edgeId]))
	editingEdgeId.value = edgeId
}

async function commitEdgeLabel(edgeId: string, raw: string) {
	if (editingEdgeId.value === edgeId) {
		editingEdgeId.value = null
	}
	const ws = workspace.value
	if (!ws || !ws.can_write) return
	const connection = ws.connections_for(folderId.value).find(c => c.id === edgeId)
	if (!connection) return
	const trimmed = raw.trim()
	const label = trimmed === '' ? undefined : trimmed
	if ((connection.label ?? undefined) === label) return
	const next: Connection = { ...connection }
	if (label === undefined) {
		delete next.label
	} else {
		next.label = label
	}
	const folder_id = folderId.value
	await record_action(ws, { folder_id }, t('undo.arrow'), tx => ws.upsert_connections(folder_id, [next], { tx }))
}

function onEdgeDoubleClick(event: EdgeMouseEvent) {
	event.event.stopPropagation()
	event.event.preventDefault()
	beginEdgeLabelEdit(event.edge.id)
}

provide(canvasEdgeLabelEditKey, {
	editingEdgeId,
	beginEdit: beginEdgeLabelEdit,
	commitLabel: commitEdgeLabel,
	cancelEdit: () => {
		editingEdgeId.value = null
	},
})

provide(canvasNodeResizeKey, {
	onStart: onNodeResizeStart,
	onLive: onNodeResizeLive,
	onEnd: onNodeResizeEnd,
	onTextLive: onTextResizeLive,
	onTextEnd: onTextResizeEnd,
})
provide(canvasLineGeometryKey, applyLineGeometryLive)

const {
	nodeTypes,
	edgeTypes,
	flowNodes,
	flowEdges,
	isSelectTool,
	isLassoTool,
	isHandTool,
	isConnectTool,
	isDrawTool,
	selectedStrokeCount,
	selectedWidgetCount,
	preventScrolling,
	pinchEnabled,
	panOnDrag,
	snapToGrid,
	snapGrid,
	applyStrokeSelection,
	applyWidgetSelection,
	clearStrokeSelection,
	clearWidgetNodeSelection,
	onNodesChange,
	setStrokePosition,
	setWidgetPosition,
} = useCanvasFlow({
	widgetNodes,
	strokeNodes,
	// shallowRef<Edge[]> (TS2589 shield) → the structural FlowEdgeLike view
	edges: edges as unknown as Ref<FlowEdgeLike[]>,
	editingNoteId,
	tool: activeTool,
	panOnly: spacePan,
	boardSnapSettings,
	deleteStrokes,
})

const {
	onInit,
	screenToFlowCoordinate,
	viewport,
	removeNodes,
	setViewport,
	fitView,
	zoomIn,
	zoomOut,
	zoomTo,
	userSelectionRect,
	nodes,
} = useVueFlow(flowId)

provide(canvasZoomKey, () => viewport.value.zoom || 1)

// A note opened for typing on a phone stays above the keyboard
useRevealEditingNote({
	editingNoteId,
	paneElement: () => flowWrapper.value,
	pan: (dx, dy) => {
		const { x, y, zoom } = viewport.value
		void setViewport({ x: x + dx, y: y + dy, zoom })
	},
	enabled: () => !isEmbedded,
})

const zoomPercent = computed(() => Math.round(viewport.value.zoom * 100))

const {
	menuRef: zoomMenuRef,
	open: zoomMenuOpen,
	openIfFine: openZoomMenuIfFine,
	closeIfFine: closeZoomMenuIfFine,
	onFocusOut: onZoomMenuFocusOut,
	toggleIfCoarse: toggleZoomMenuIfCoarse,
	closeIfCoarse: closeZoomMenuIfCoarse,
} = useHoverClickMenu()

function resetZoom() {
	const { x, y } = viewport.value
	void setViewport({ x, y, zoom: 1 })
	closeZoomMenuIfCoarse()
}

function fitToView() {
	void fitView({ padding: 0.2 })
	closeZoomMenuIfCoarse()
}

function on_dock_zoom(action: DockZoomAction) {
	if (action === 'in') void zoomIn()
	else if (action === 'out') void zoomOut()
	else if (action === 'fit') void fitView({ padding: 0.2 })
	// Around the middle of what is on screen: the picture stays where it is
	else void zoomTo(1)
}

/** A note or a connection's label is being typed */
const editingText = computed(() => editingNoteId.value !== null || editingEdgeId.value !== null)

/**
 * The panel's buttons do not take the focus (the next Space must move the
 * canvas, not press them), so a tool picked there ends the typing itself, as
 * a click anywhere else does.
 */
function on_dock_tool(next: EditorTool) {
	if (editingText.value && document.activeElement instanceof HTMLElement) document.activeElement.blur()
	on_tool_update(next)
}

const canUndo = computed(() => history.can_undo && !editingText.value)
const canRedo = computed(() => history.can_redo && !editingText.value)

// Text being typed has its own undo: the panel's buttons leave it alone
function on_undo() {
	if (!editingText.value) void history.undo()
}

function on_redo() {
	if (!editingText.value) void history.redo()
}

/** A phone's keyboard is up: the panel gets out of the way of what is being typed */
const dockTucked = computed(() => isCoarsePointer.value && editingText.value)

/** Single screen→flow mapping for drawing, pane clicks, and the context menu. */
function toFlowCoords(event: { clientX: number; clientY: number }): Position {
	return screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
}

const lineDraw = useLineDrawMode({
	folderId,
	isEmbedded,
	plainLineHotkey: false,
	resolvePoint: toFlowCoords,
	isEmptyTarget: (target) =>
		target instanceof HTMLElement && isEmptyCanvasTarget(target),
})

onMounted(() => {
	lineDraw.bind(flowWrapper.value)
	registerPanePositionResolver(folderId.value, (clientX, clientY) =>
		toFlowCoords({ clientX, clientY }),
	)
	registerPaneEditingNoteSetter(folderId.value, (noteId) => {
		editingNoteId.value = noteId
	})
	if (isEmbedded) return
	setExternalDropPositionResolver((clientX, clientY) =>
		toFlowCoords({ clientX, clientY }),
	)
})

onUnmounted(() => {
	lineDraw.bind(null)
	registerPanePositionResolver(folderId.value, null)
	registerPaneEditingNoteSetter(folderId.value, null)
	if (isEmbedded) return
	setExternalDropPositionResolver(null)
})

const {
	boardPlacementTemplate,
	clearBoardPlacement,
	contextMenuPosition,
	rememberContextMenuPosition,
	createNoteAt,
	createTextAt,
	createFolderAt,
	onPaneClick: onSharedPaneClick,
	onPaneContextMenu,
} = useFolderPaneActions({
	folderId,
	editingNoteId,
	resolvePosition: toFlowCoords,
})

// T arms one text block for the next click on empty pane. Only the hand and
// select tools click on the pane; with the pen or the lasso a click is a stroke.
const textPlace = useTextPlaceMode({
	isEmbedded,
	canArm: () => isHandTool.value || isSelectTool.value,
})

// One placement tool at a time: arming a line, picking a shape or switching to
// another tool drops the text one.
watch(() => lineDraw.armed.value, (kind) => {
	if (kind) textPlace.disarm()
})
watch(textPlace.armed, (armed) => {
	if (armed) lineDraw.disarm()
})
watch(boardPlacementTemplate, (template) => {
	if (template) textPlace.disarm()
})
watch(tool, () => textPlace.disarm())

const viewportSnapshot = computed<BoardViewport>(() => ({
	x: viewport.value.x,
	y: viewport.value.y,
	zoom: viewport.value.zoom,
}))

const paneFill = useResolvedFill(folderId, () => container.value?.background)
const canvasStyle = computed(() => backgroundStyle(paneFill.value, defaultViewBackground))
const flowWrapperStyle = computed(() => ({
	...canvasStyle.value,
	...(activeTool.value === 'pen' && !lineDraw.armed.value ? { cursor: PEN_CURSOR } : {}),
}))

const {
	previewPath,
	previewPointCount,
	lassoPath,
	removeStrokeNode,
	cancelLasso,
	bindPane,
	bindPinch,
} = useCanvasGestures({
	strokeNodes,
	widgetNodes,
	edges: edges as unknown as Ref<FlowEdgeLike[]>,
	tool: activeTool,
	penColor,
	penWidth,
	applyStrokeSelection,
	applyWidgetSelection,
	applyEdgeSelection,
	flowWrapper,
	paneEl,
	pinchEnabled,
	getViewport: () => viewportSnapshot.value,
	setViewport: (vp) => {
		flowStore.value?.setViewport(vp)
	},
	screenToFlow: (clientX, clientY) =>
		screenToFlowCoordinate({ x: clientX, y: clientY }),
	nextStrokeZ,
	onStrokeCommit,
})

useCanvasMarqueeEdges({
	isSelectTool,
	widgetNodes,
	edges: edges as unknown as Ref<FlowEdgeLike[]>,
	userSelectionRect: userSelectionRect as unknown as Ref<{
		x: number
		y: number
		width: number
		height: number
	} | null>,
	viewport: viewportSnapshot,
	applyEdgeSelection,
})

const {
	onNodeDragStart,
	onNodeDrag,
	onNodeDragStop,
	onNodeClick,
	onNodeMouseEnter,
	onNodeMouseLeave,
	onEdgeClick,
	deleteSelectedStrokes,
} = useCanvasNodeInteractions({
	folderId,
	tool: activeTool,
	hoveredNodeId,
	isStrokeDragging,
	isWidgetDragging,
	setStrokePosition,
	setWidgetPosition,
	persistStrokes,
	deleteStrokes,
	onWidgetDragStop,
	removeStrokeNode,
	removeConnection,
	selectedStrokeIds: computed(() =>
		strokeNodes.value.filter(node => node.selected).map(node => node.id),
	),
	removeNodes,
})

/**
 * Vue Flow drags every selected node plus the one under the pointer.
 * Match the board: a grab outside a 2+ selection moves only that node.
 * Mutate store nodes in place — replacing `:nodes` would reset live positions.
 */
let soloDragSnapshot: DraggableSnapshot | null = null

function releaseSoloDragLock() {
	if (!soloDragSnapshot) return
	restoreDraggable(nodes.value, soloDragSnapshot)
	soloDragSnapshot = null
}

function endSoloDragPointerWatch() {
	window.removeEventListener('pointerup', onSoloDragPointerEnd, true)
	window.removeEventListener('pointercancel', onSoloDragPointerEnd, true)
}

function onSoloDragPointerEnd() {
	endSoloDragPointerWatch()
	releaseSoloDragLock()
}

/**
 * A click is on the empty canvas only if its press was too: a text selection
 * dragged out of a note or a shape is released on the pane, and must not end
 * the editing.
 */
let pressOnEmptyCanvas = false

function onFlowPointerDown(event: PointerEvent) {
	pressOnEmptyCanvas = event.target instanceof Element && isEmptyCanvasTarget(event.target)
	if (event.button !== 0) return
	const target = event.target
	if (!(target instanceof Element)) return
	if (target.closest('.nodrag')) return
	const nodeEl = target.closest('.vue-flow__node')
	if (!(nodeEl instanceof HTMLElement)) return
	const id = nodeEl.dataset.id
	if (!id) return
	const graphNodes = nodes.value
	const grabbed = graphNodes.find(node => node.id === id)
	if (!grabbed?.draggable) return
	if (draggedNodeParticipatesInGroup(id, graphNodes)) return
	releaseSoloDragLock()
	const snapshot = lockSoloDrag(graphNodes, id)
	if (snapshot.size === 0) return
	soloDragSnapshot = snapshot
	endSoloDragPointerWatch()
	window.addEventListener('pointerup', onSoloDragPointerEnd, true)
	window.addEventListener('pointercancel', onSoloDragPointerEnd, true)
}

function onFlowNodeDragStart(event: NodeDragEvent) {
	// getDragItems has already snapshotted the solo set.
	releaseSoloDragLock()
	onNodeDragStart(event)
}

onUnmounted(() => {
	endSoloDragPointerWatch()
	releaseSoloDragLock()
})

onInit((vueFlowStore) => {
	flowStore.value = vueFlowStore
	void nextTick(() => {
		paneEl.value =
			flowWrapper.value?.querySelector<HTMLElement>('.vue-flow__pane') ?? null
		bindPane(paneEl.value)
		bindPinch(flowWrapper.value)
	})
})

watch(tool, (next) => {
	hoveredNodeId.value = null
	cancelLasso()
	if (next === 'pen' || next === 'lasso' || next === 'eraser') {
		clearBoardPlacement()
	}
	if (EDGE_LABEL_BLOCKED_TOOLS.has(next)) {
		editingEdgeId.value = null
	}
	if (next === 'select') return
	clearStrokeSelection()
	clearWidgetNodeSelection()
	workspace.value?.clear_selection()
	if (next === 'hand') return
	clearEdgeSelection()
})

async function onPaneClick(event: MouseEvent) {
	if (!pressOnEmptyCanvas) return
	// Space is held to move the canvas: a click then leaves the selection alone
	if (spacePan.value) return
	if (isDrawTool.value || isLassoTool.value) return
	if (lineDraw.armed.value) return
	if (textPlace.armed.value) {
		textPlace.disarm()
		await createTextAt(event)
		return
	}
	await onSharedPaneClick(event)
}

function isEmptyCanvasTarget(target: Element) {
	if (target.closest('.vue-flow__node')) return false
	if (target.closest('.vue-flow__edge')) return false
	if (target.closest('.vue-flow__edge-labels')) return false
	if (target.closest('.canvas-edge-label')) return false
	if (target.closest('.vue-flow__controls')) return false
	if (target.closest('.canvas-zoom-readout')) return false
	if (target.closest('.canvas-drawing-toolbar')) return false
	if (target.closest('.canvas-dock')) return false
	return Boolean(
		target.closest('.vue-flow__pane')
		|| target.closest('.vue-flow__background'),
	)
}

function onSectionDblClick(event: MouseEvent) {
	if (isDrawTool.value || isLassoTool.value) return
	if (lineDraw.armed.value) return
	if (!isEmptyCanvasTarget(event.target as HTMLElement)) return
	if (event.shiftKey) {
		void createFolderAt(event)
		return
	}
	void createNoteAt(event)
}

function onSectionContextMenu(event: MouseEvent) {
	// Read-only viewers get no menu at all — every mutation item would be
	// disabled anyway; preventDefault also suppresses the native browser menu
	if (!can_write.value) {
		event.preventDefault()
		return
	}
	if (lineDraw.armed.value) return
	if (!isEmptyCanvasTarget(event.target as HTMLElement)) return
	onPaneContextMenu(event)
}

function onSectionPointerDown(event: PointerEvent) {
	if (!isEmptyCanvasTarget(event.target as HTMLElement)) return
	rememberContextMenuPosition(event)
}
</script>

<template>
	<FolderContainerCtxMenu :disabled="!can_write" :position="contextMenuPosition">
		<section
			class="canvas-section"
			:class="{ 'canvas-section--embedded': isEmbedded }"
			:style="canvasStyle"
			:data-path="folderId"
			@dblclick="onSectionDblClick"
			@contextmenu="onSectionContextMenu"
			@pointerdown.capture="onSectionPointerDown"
		>
			<PileImagePending :folder_id="folderId" role="background" />
			<CanvasDrawingToolbar
				v-if="toolbarPrefs.classic"
				ref="toolbarHost"
				v-show="!toolbarPrefs.hidden && can_write"
				:tool="tool"
				:pen-color="penColor"
				:pen-width="penWidth"
				:selected-stroke-count="selectedStrokeCount"
				:selected-connection="selectedConnection"
				:compact="toolbarCompact"
				:compact-view="toolbarPrefs.compactView"
				:side="toolbarPrefs.side"
				@update:tool="on_tool_update"
				@update:pen-color="penColor = $event"
				@update:pen-width="penWidth = $event"
				@delete-selected="deleteSelectedStrokes"
				@update-connection="on_update_connection"
				@delete-connection="on_delete_connection"
			/>
			<div
				ref="flowWrapper"
				class="canvas-flow-wrapper"
				:class="{ 'canvas-flow-wrapper--pen': activeTool === 'pen' && !lineDraw.armed.value }"
				:style="flowWrapperStyle"
				@pointerdown.capture="onFlowPointerDown"
			>
				<VueFlow
					:id="flowId"
					:nodes="flowNodes"
					v-model:edges="flowEdges"
					class="canvas-flow"
					:class="[`canvas-flow--${activeTool}`, { 'canvas-flow--embedded': isEmbedded, 'canvas-flow--text-place': textPlace.armed.value, 'canvas-flow--space': spacePan }]"
					:style="{ cursor: lineDraw.cursor.value || undefined }"
					:node-types="nodeTypes"
					:edge-types="edgeTypes"
					:snap-to-grid="snapToGrid"
					:snap-grid="snapGrid"
					:zoom-on-double-click="false"
					:default-edge-options="{ type: 'labeled', interactionWidth: 20 }"
					:nodes-draggable="(isHandTool || isSelectTool) && can_write && !spacePan"
					:select-nodes-on-drag="!isSelectTool"
					:nodes-selectable="isSelectTool"
					:elements-selectable="isSelectTool || isHandTool"
					:nodes-connectable="isConnectTool && can_write"
					:pan-on-drag="panOnDrag"
					:selection-key-code="isSelectTool ? true : null"
					:multi-selection-key-code="isSelectTool ? true : null"
					:selection-mode="SelectionMode.Partial"
					:pan-on-scroll="true"
					:pan-on-scroll-speed="0.85"
					:min-zoom="ZOOM_MIN"
					:max-zoom="ZOOM_MAX"
					:zoom-on-pinch="!isDrawTool && !isLassoTool"
					:zoom-on-scroll="false"
					:prevent-scrolling="preventScrolling"
					:delete-key-code="(isSelectTool || isHandTool) && can_write && selectedWidgetCount === 0 && !editingEdgeId ? ['Backspace', 'Delete'] : null"
					edges-deletable
					fit-view-on-init
					@connect="onConnect"
					@edges-change="onEdgesChange"
					@edge-click="onEdgeClick"
					@edge-double-click="onEdgeDoubleClick"
					@pane-click="onPaneClick"
					@nodes-change="onNodesChange"
					@node-drag-start="onFlowNodeDragStart"
					@node-drag="onNodeDrag"
					@node-drag-stop="onNodeDragStop"
					@node-click="onNodeClick"
					@node-mouse-enter="onNodeMouseEnter"
					@node-mouse-leave="onNodeMouseLeave"
				>
					<Background
						v-show="showGridDots"
						id="grid-dots"
					/>
					<div
						v-if="toolbarPrefs.classic"
						v-show="!toolbarPrefs.hidden"
						ref="zoomMenuRef"
						class="canvas-zoom-readout"
						@pointerdown.stop
						@mouseenter="openZoomMenuIfFine"
						@mouseleave="closeZoomMenuIfFine"
						@focusin="openZoomMenuIfFine"
						@focusout="onZoomMenuFocusOut"
						@keydown.escape="zoomMenuOpen = false"
					>
						<button
							type="button"
							class="canvas-zoom-readout__trigger"
							:aria-expanded="zoomMenuOpen"
							aria-haspopup="true"
							:aria-controls="`${flowId}-zoom-menu`"
							:title="`Zoom ${zoomPercent}%`"
							:aria-label="`Zoom ${zoomPercent}%, canvas zoom options`"
							@click="toggleZoomMenuIfCoarse"
						>
							<span class="canvas-zoom-readout__value" aria-live="polite">
								{{ zoomPercent }}%
							</span>
							<UIcon
								name="i-lucide-chevron-up"
								class="canvas-zoom-readout__chevron"
								:class="{ 'canvas-zoom-readout__chevron--open': zoomMenuOpen }"
							/>
						</button>
						<div
							v-show="zoomMenuOpen"
							:id="`${flowId}-zoom-menu`"
							class="canvas-zoom-readout__panel"
							role="menu"
							aria-label="Canvas zoom"
						>
							<button
								type="button"
								class="canvas-zoom-readout__action"
								role="menuitem"
								@click="fitToView"
							>
								<UIcon name="i-lucide-scan" class="canvas-zoom-readout__icon" />
								Fit To View
							</button>
							<button
								type="button"
								class="canvas-zoom-readout__action"
								role="menuitem"
								@click="resetZoom"
							>
								<UIcon name="i-lucide-rotate-ccw" class="canvas-zoom-readout__icon" />
								Reset Zoom
							</button>
						</div>
					</div>
				</VueFlow>
				<CanvasAxes
					v-if="showAxes"
					:viewport="viewportSnapshot"
				/>
				<DrawingPreview
					v-if="activeTool === 'pen' || previewPath"
					:path-d="previewPath"
					:is-dot="previewPointCount === 1"
					:color="penColor"
					:stroke-width="penWidth"
					:viewport="viewportSnapshot"
				/>
			<LassoPreview
				v-if="activeTool === 'lasso' || lassoPath"
				:path-d="lassoPath"
				:viewport="viewportSnapshot"
			/>
			<LineDrawPreview
				v-if="lineDraw.preview.value"
				:start="lineDraw.preview.value.start"
				:end="lineDraw.preview.value.end"
				:arrow="lineDraw.armed.value === 'arrow'"
				:viewport="viewportSnapshot"
			/>
			<EmptyPaneHint :empty="isCanvasEmpty" />
			</div>
			<CanvasDock
				v-if="!toolbarPrefs.classic && !toolbarPrefs.hidden"
				v-show="!dockTucked"
				:tool="tool"
				:space-pan="spacePan"
				:zoom-percent="zoomPercent"
				:can-write="can_write"
				:embedded="isEmbedded"
				:can-undo="canUndo"
				:can-redo="canRedo"
				:pen-color="penColor"
				:pen-width="penWidth"
				:selected-stroke-count="selectedStrokeCount"
				:selected-connection="selectedConnection"
				@update:tool="on_dock_tool"
				@update:pen-color="penColor = $event"
				@update:pen-width="penWidth = $event"
				@delete-selected="deleteSelectedStrokes"
				@update-connection="on_update_connection"
				@delete-connection="on_delete_connection"
				@zoom="on_dock_zoom"
				@undo="on_undo"
				@redo="on_redo"
			/>
		</section>
	</FolderContainerCtxMenu>
</template>

<style scoped>
.canvas-section {
	position: relative;
	display: flex;
	flex-direction: column;
	height: 100%;
	min-height: 0;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}

.canvas-flow-wrapper {
	position: relative;
	flex: 1;
	min-height: 0;
	touch-action: none;
	overscroll-behavior: none;
}

.canvas-section :deep(.vue-flow),
.canvas-flow {
	height: 100%;
	min-height: 320px;
}

.canvas-flow--embedded {
	min-height: 0;
}

.canvas-flow-wrapper--pen :deep(*) {
	cursor: inherit !important;
}

.canvas-flow-wrapper--pen :deep(.canvas-zoom-readout),
.canvas-flow-wrapper--pen :deep(.canvas-zoom-readout *) {
	cursor: pointer !important;
}

.canvas-flow--lasso {
	cursor: crosshair;
}

/* What the lasso selected can be dragged at once: the hand says so. A note
   being typed in keeps its text cursor. */
.canvas-flow--lasso :deep(.vue-flow__node.selected:not(:has(.is_edit))),
.canvas-flow--lasso :deep(.vue-flow__node.selected:not(:has(.is_edit)) *) {
	cursor: grab !important;
}

.canvas-flow--lasso :deep(.vue-flow__node.selected.dragging),
.canvas-flow--lasso :deep(.vue-flow__node.selected.dragging *) {
	cursor: grabbing !important;
}

.canvas-flow--eraser {
	cursor: pointer;
}

.canvas-flow--hand {
	cursor: grab;
}

.canvas-flow--hand:active {
	cursor: grabbing;
}

.canvas-flow--hand :deep(.vue-flow__edge),
.canvas-flow--select :deep(.vue-flow__edge) {
	cursor: pointer;
}

.canvas-flow--select {
	cursor: default;
}

.canvas-flow--connect {
	cursor: crosshair;
}

/* Space is held: a drag moves the canvas from anywhere, so the hand shows over
   cards too. The box around a group selection would take the drag otherwise. */
.canvas-flow--space,
.canvas-flow--space :deep(*) {
	cursor: grab !important;
}

.canvas-flow--space:active,
.canvas-flow--space:active :deep(*) {
	cursor: grabbing !important;
}

/* A press on a card's edge moves the canvas too, it does not resize the card */
.canvas-flow--space :deep(.vue-flow__resize-control) {
	pointer-events: none;
}

/* Both: the rect inside sets its own pointer-events */
.canvas-flow--space :deep(.vue-flow__nodesselection),
.canvas-flow--space :deep(.vue-flow__nodesselection-rect) {
	pointer-events: none;
}

/* T is armed: the next click on the pane drops a text block. The pane has its
   own grab cursor with the hand tool, so the text cursor is forced on it. */
.canvas-flow--text-place,
.canvas-flow--text-place :deep(.vue-flow__pane) {
	cursor: text !important;
}

.canvas-flow--disconnect {
	cursor: pointer;
}

.canvas-flow--disconnect :deep(.vue-flow__edge:hover .vue-flow__edge-path) {
	stroke: #ef4444;
}

/* Selected edge affordance: this is the edge the toolbar props apply to. */
.canvas-flow :deep(.vue-flow__edge.selected .vue-flow__edge-path) {
	stroke: #2563eb;
	stroke-width: 2;
}

/* Lift the dragged node(s) above later siblings so drop-over-folder is visible. */
.canvas-flow :deep(.vue-flow__node.dragging) {
	z-index: 10000 !important;
}

/* The layers panel outlines the widget; the node has to rise or a later one covers it. */
.canvas-flow :deep(.vue-flow__node:has(.pc-layer-peek)) {
	z-index: 1000 !important;
}

/* Edit shadow lives on the inner note widget; raise the VF node so it isn't
 * clipped under later nodes. */
.canvas-flow :deep(.vue-flow__node:has(.is_edit)) {
	z-index: 9998 !important;
	overflow: visible;
}

/* Default VF selection uses a dotted border that leaves trails while dragging.
 * Inset shadow stays inside the rect bounds under CSS transforms. */
.canvas-flow :deep(.vue-flow__nodesselection-rect),
.canvas-flow :deep(.vue-flow__selection) {
	background: rgba(37, 99, 235, 0.06);
	border: none;
	border-radius: 6px;
	box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.4);
}

/* Line widgets: VF node box must not steal hits from widgets under the AABB.
 * pointer-events is not inherited — zero out descendants, then re-enable hits. */
.canvas-flow :deep(.vue-flow__node:has(.canvas-widget-node--line)),
.canvas-flow :deep(.vue-flow__node:has(.canvas-widget-node--line) *) {
	pointer-events: none !important;
}

.canvas-flow :deep(.vue-flow__node:has(.canvas-widget-node--line) .pc-line-hit) {
	pointer-events: stroke !important;
}

.canvas-flow :deep(.vue-flow__node:has(.canvas-widget-node--line) .pc-line-head),
.canvas-flow :deep(.vue-flow__node:has(.canvas-widget-node--line) .line-endpoint-handle),
.canvas-flow :deep(.vue-flow__node:has(.canvas-widget-node--line) .canvas-handle) {
	pointer-events: auto !important;
}

/* A folder preview shows its panel while the pointer is over it (of nested
   previews, the innermost one), while its menu is open, and while its tool is
   not Hand. A touch screen has no hover: there the panel is always shown. */
@media (hover: hover) and (pointer: fine) {
	.canvas-section--embedded > .canvas-dock {
		visibility: hidden;
		opacity: 0;
	}

	.canvas-section--embedded:hover:not(:has(.canvas-section:hover)) > .canvas-dock:not(.canvas-dock--unmeasured),
	.canvas-section--embedded:focus-within:not(:has(.canvas-section:focus-within)) > .canvas-dock:not(.canvas-dock--unmeasured),
	.canvas-section--embedded > .canvas-dock--pinned:not(.canvas-dock--unmeasured) {
		visibility: visible;
		opacity: 1;
	}
}

.canvas-zoom-readout {
	position: absolute;
	bottom: 10px;
	right: 10px;
	left: auto;
	z-index: 5;
}

.canvas-zoom-readout__trigger {
	display: inline-flex;
	align-items: center;
	gap: 0.125rem;
	padding: 0.25rem 0.375rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.375rem;
	background: #fefefe;
	color: #111827;
	font-size: 12px;
	line-height: 1;
	cursor: pointer;
}

.canvas-zoom-readout__trigger:hover {
	background: #f9fafb;
}

.canvas-zoom-readout__trigger:focus-visible,
.canvas-zoom-readout__action:focus-visible {
	outline: 2px solid #2563eb;
	outline-offset: 1px;
}

.canvas-zoom-readout__value {
	min-width: 2.75rem;
	text-align: center;
	font-variant-numeric: tabular-nums;
	user-select: none;
}

.canvas-zoom-readout__chevron {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
	color: #6b7280;
	transition: transform 0.15s ease;
}

.canvas-zoom-readout__chevron--open {
	transform: rotate(180deg);
}

.canvas-zoom-readout__panel {
	position: absolute;
	bottom: calc(100% + 4px);
	right: 0;
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	min-width: 10.5rem;
	padding: 0.375rem;
	border: 1px solid rgba(0, 0, 0, 0.1);
	border-radius: 0.375rem;
	background: #fefefe;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.canvas-zoom-readout__panel::after {
	content: '';
	position: absolute;
	top: 100%;
	right: 0;
	left: 0;
	height: 6px;
}

.canvas-zoom-readout__action {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	width: 100%;
	min-height: 36px;
	padding: 0.375rem 0.5rem;
	border: none;
	border-radius: 0.25rem;
	background: transparent;
	color: #111827;
	font-size: 12px;
	text-align: left;
	cursor: pointer;
	white-space: nowrap;
}

.canvas-zoom-readout__action:hover {
	background: var(--pc-gray-muted);
}

.canvas-zoom-readout__icon {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
	color: #374151;
}
</style>

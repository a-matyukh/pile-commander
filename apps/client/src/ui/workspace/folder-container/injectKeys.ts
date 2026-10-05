import type { InjectionKey, ComputedRef, Ref } from 'vue'
import type { Position, Size } from '@/domain/Widget'
import type { BoardSnapSettings } from '@/services/board/layout'
import type { BoardDragState } from './board/useBoardWidget'
import type { EditorTool } from './canvas/drawing/types'

export const widgetLayoutModeKey: InjectionKey<'board' | 'canvas'> =
	Symbol('widgetLayoutMode')

export const boardDragStateKey: InjectionKey<BoardDragState> =
	Symbol('boardDragState')

export const boardSnapSettingsKey: InjectionKey<ComputedRef<BoardSnapSettings>> =
	Symbol('boardSnapSettings')

export type CanvasNodeResizeHandlers = {
	onStart: (nodeId: string, size: Size) => void
	onLive: (nodeId: string, size: Size) => void
	onEnd: (nodeId: string, size: Size) => void
}

export const canvasNodeResizeKey: InjectionKey<CanvasNodeResizeHandlers> =
	Symbol('canvasNodeResize')

export type CanvasLineGeometryLive = {
	position: Position
	size: Size
}

export const canvasLineGeometryKey: InjectionKey<
	(nodeId: string, geometry: CanvasLineGeometryLive) => void
> = Symbol('canvasLineGeometry')

/** Current Vue Flow zoom for converting pointer deltas in canvas. */
export const canvasZoomKey: InjectionKey<() => number> = Symbol('canvasZoom')

export const canvasEditorToolKey: InjectionKey<Ref<EditorTool>> =
	Symbol('canvasEditorTool')

/** Double-click edge label editing (Figma-style inline caption). */
export type CanvasEdgeLabelEdit = {
	editingEdgeId: Ref<string | null>
	beginEdit: (edgeId: string) => void
	commitLabel: (edgeId: string, raw: string) => Promise<void>
	cancelEdit: () => void
}

export const canvasEdgeLabelEditKey: InjectionKey<CanvasEdgeLabelEdit> =
	Symbol('canvasEdgeLabelEdit')

/** Nesting level of embedded folder previews (0 = top-level view). */
export const folderPreviewDepthKey: InjectionKey<number> =
	Symbol('folderPreviewDepth')

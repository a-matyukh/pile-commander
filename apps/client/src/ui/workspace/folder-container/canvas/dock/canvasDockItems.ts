import type { EditorTool } from '../drawing/types'
import { CANVAS_TOOL_HOTKEYS } from '../useCanvasToolShortcuts'

/** What stands on the canvas panel: the tools and the zoom (undo is in the top bar) */
export type DockItemId = EditorTool | 'zoom'

/** What the zoom readout's menu does */
export type DockZoomAction = 'in' | 'out' | 'fit' | 'reset'

export type DockItem = {
	id: DockItemId
	/** Items of one group stand together; a separator goes between groups */
	group: number
	/** On a narrow canvas the item with the highest number leaves the panel first */
	keep: number
}

export type DockTool = {
	id: EditorTool
	icon: string
	label_key: string
	hotkey: string
}

/** The tools in the panel's order */
export const DOCK_TOOLS: DockTool[] = [
	{ id: 'hand', icon: 'tabler:hand-stop', label_key: 'canvas_dock.hand', hotkey: CANVAS_TOOL_HOTKEYS.hand },
	{ id: 'select', icon: 'tabler:pointer', label_key: 'canvas_dock.select', hotkey: CANVAS_TOOL_HOTKEYS.select },
	{ id: 'lasso', icon: 'tabler:lasso', label_key: 'canvas_dock.lasso', hotkey: CANVAS_TOOL_HOTKEYS.lasso },
	{ id: 'connect', icon: 'tabler:vector-spline', label_key: 'canvas_dock.connect', hotkey: CANVAS_TOOL_HOTKEYS.connect },
	{ id: 'disconnect', icon: 'tabler:unlink', label_key: 'canvas_dock.disconnect', hotkey: CANVAS_TOOL_HOTKEYS.disconnect },
	{ id: 'pen', icon: 'tabler:pencil', label_key: 'canvas_dock.pen', hotkey: CANVAS_TOOL_HOTKEYS.pen },
	{ id: 'eraser', icon: 'tabler:eraser', label_key: 'canvas_dock.eraser', hotkey: CANVAS_TOOL_HOTKEYS.eraser },
]

const TOOL_BY_ID = new Map(DOCK_TOOLS.map(tool => [tool.id, tool]))

export function dock_tool(id: DockItemId): DockTool | undefined {
	return TOOL_BY_ID.get(id as EditorTool)
}

/**
 * The panel's make-up, left to right. One list on purpose: a person's own
 * choice of what stays on the panel and what goes under "more" would replace
 * `keep` here, and the layout and the menu follow it as they are.
 */
const DOCK_ITEMS: DockItem[] = [
	{ id: 'hand', group: 1, keep: 1 },
	{ id: 'select', group: 1, keep: 2 },
	{ id: 'lasso', group: 1, keep: 7 },
	{ id: 'connect', group: 2, keep: 6 },
	{ id: 'disconnect', group: 2, keep: 9 },
	{ id: 'pen', group: 3, keep: 3 },
	{ id: 'eraser', group: 3, keep: 4 },
	{ id: 'zoom', group: 4, keep: 10 },
]

/**
 * What this canvas's panel holds. A viewer only looks, so only the zoom is
 * left. Undo is the window's, in the top bar.
 */
export function dock_items(options: { can_write: boolean; embedded: boolean }): DockItem[] {
	if (!options.can_write) return DOCK_ITEMS.filter(item => item.id === 'zoom')
	return DOCK_ITEMS
}

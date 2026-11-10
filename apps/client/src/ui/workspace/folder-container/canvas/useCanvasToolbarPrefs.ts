import { createGlobalState, useStorage } from '@vueuse/core'
import type { EditorTool } from './drawing/types'

export const CANVAS_TOOLBAR_PREFS_KEY = 'pile_commander_canvas_toolbar'

export type CanvasToolbarSide = 'top' | 'bottom'

export type CanvasToolbarPrefs = {
	hidden: boolean
	/** The old toolbar along the top or bottom edge, instead of the panel at the bottom center */
	classic: boolean
	/** The classic toolbar's: one button that opens the tools */
	compactView: boolean
	/** The classic toolbar's edge */
	side: CanvasToolbarSide
}

export const DEFAULT_CANVAS_TOOLBAR_PREFS: CanvasToolbarPrefs = {
	hidden: false,
	classic: false,
	compactView: false,
	side: 'top',
}

export function mergeCanvasToolbarPrefs(
	stored: unknown,
	defaults: CanvasToolbarPrefs = DEFAULT_CANVAS_TOOLBAR_PREFS,
): CanvasToolbarPrefs {
	const source = stored && typeof stored === 'object' && !Array.isArray(stored)
		? stored as Record<string, unknown>
		: {}
	return {
		hidden: typeof source.hidden === 'boolean' ? source.hidden : defaults.hidden,
		classic: typeof source.classic === 'boolean' ? source.classic : defaults.classic,
		compactView: typeof source.compactView === 'boolean' ? source.compactView : defaults.compactView,
		side: source.side === 'bottom' || source.side === 'top' ? source.side : defaults.side,
	}
}

/** Hidden toolbar is always Hand — hotkeys and clicks cannot switch tools. */
export function isCanvasToolAllowed(tool: EditorTool, hidden: boolean): boolean {
	return !hidden || tool === 'hand'
}

export const useCanvasToolbarPrefs = createGlobalState(() =>
	useStorage<CanvasToolbarPrefs>(
		CANVAS_TOOLBAR_PREFS_KEY,
		{ ...DEFAULT_CANVAS_TOOLBAR_PREFS },
		undefined,
		{ mergeDefaults: mergeCanvasToolbarPrefs },
	),
)

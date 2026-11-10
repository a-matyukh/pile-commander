import { createGlobalState, useStorage } from '@vueuse/core'

export const CANVAS_PEN_PREFS_KEY = 'pile_commander_canvas_pen'

export const PEN_WIDTH_MIN = 1
export const PEN_WIDTH_MAX = 24

/** The pen is the person's, not a folder's: it draws the same in every canvas */
export type CanvasPenPrefs = {
	color: string
	width: number
}

export const DEFAULT_CANVAS_PEN_PREFS: CanvasPenPrefs = {
	color: '#111827',
	width: 4,
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i

export function mergeCanvasPenPrefs(
	stored: unknown,
	defaults: CanvasPenPrefs = DEFAULT_CANVAS_PEN_PREFS,
): CanvasPenPrefs {
	const source = stored && typeof stored === 'object' && !Array.isArray(stored)
		? stored as Record<string, unknown>
		: {}
	const width = typeof source.width === 'number' && Number.isFinite(source.width)
		? Math.min(PEN_WIDTH_MAX, Math.max(PEN_WIDTH_MIN, Math.round(source.width)))
		: defaults.width
	return {
		color: typeof source.color === 'string' && HEX_COLOR.test(source.color) ? source.color : defaults.color,
		width,
	}
}

export const useCanvasPenPrefs = createGlobalState(() =>
	useStorage<CanvasPenPrefs>(
		CANVAS_PEN_PREFS_KEY,
		{ ...DEFAULT_CANVAS_PEN_PREFS },
		undefined,
		{ mergeDefaults: mergeCanvasPenPrefs },
	),
)

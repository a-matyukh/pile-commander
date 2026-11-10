import { computed, provide, ref } from 'vue'
import { strokeHighlightKey } from './drawing/strokeHighlight'
import type { EditorTool } from './drawing/types'
import { useCanvasPenPrefs } from './canvasPenPrefs'

/**
 * Editor tool state for the canvas view.
 * Provides the stroke-highlight context consumed by StrokeNode.
 */
export function useCanvasToolState(initialTool: EditorTool = 'hand') {
	const tool = ref<EditorTool>(initialTool)
	// The pen keeps its color and width from folder to folder and between launches
	const penPrefs = useCanvasPenPrefs()
	const penColor = computed({
		get: () => penPrefs.value.color,
		set: (color: string) => {
			penPrefs.value = { ...penPrefs.value, color }
		},
	})
	const penWidth = computed({
		get: () => penPrefs.value.width,
		set: (width: number) => {
			penPrefs.value = { ...penPrefs.value, width }
		},
	})
	const hoveredNodeId = ref<string | null>(null)

	provide(strokeHighlightKey, {
		hoveredNodeId,
		tool,
	})

	return { tool, penColor, penWidth, hoveredNodeId }
}

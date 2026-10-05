import { provide, ref } from 'vue'
import { strokeHighlightKey } from './drawing/strokeHighlight'
import type { EditorTool } from './drawing/types'

/**
 * Editor tool state for the canvas view.
 * Provides the stroke-highlight context consumed by StrokeNode.
 */
export function useCanvasToolState() {
	const tool = ref<EditorTool>('hand')
	const penColor = ref('#111827')
	const penWidth = ref(4)
	const hoveredNodeId = ref<string | null>(null)

	provide(strokeHighlightKey, {
		hoveredNodeId,
		tool,
	})

	return { tool, penColor, penWidth, hoveredNodeId }
}

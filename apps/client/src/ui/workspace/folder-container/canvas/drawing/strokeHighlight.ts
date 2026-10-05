import { inject, type InjectionKey, type Ref } from 'vue'
import type { EditorTool } from './types'

export interface StrokeHighlightContext {
	hoveredNodeId: Ref<string | null>
	tool: Ref<EditorTool>
}

export const strokeHighlightKey: InjectionKey<StrokeHighlightContext> =
	Symbol('strokeHighlight')

export function useStrokeHighlight() {
	return inject(strokeHighlightKey, null)
}

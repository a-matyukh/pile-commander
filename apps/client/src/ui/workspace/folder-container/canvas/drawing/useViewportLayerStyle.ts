import { computed, type MaybeRefOrGetter, toValue } from 'vue'
import type { BoardViewport } from './types'

/** CSS transform that maps flow coordinates onto the screen overlay layer. */
export function useViewportLayerStyle(viewport: MaybeRefOrGetter<BoardViewport>) {
	return computed(() => {
		const vp = toValue(viewport)
		return {
			transform: `translate(${vp.x}px, ${vp.y}px) scale(${vp.zoom})`,
			transformOrigin: '0 0',
		}
	})
}

import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'

/**
 * A press on the canvas closes the panel's open menu. The menu's own
 * "pressed outside" never hears it there: the pen and the lasso take the
 * press on the pane before it reaches the document.
 */
export function useCloseOnCanvasPress(open: Ref<boolean>) {
	useEventListener(window, 'pointerdown', (event: PointerEvent) => {
		if (!open.value) return
		const target = event.target
		// Not the menu itself, and not the panel: its buttons open and close their own menus
		if (target instanceof Element && target.closest('.mn, .canvas-dock')) return
		open.value = false
	}, { capture: true })
}

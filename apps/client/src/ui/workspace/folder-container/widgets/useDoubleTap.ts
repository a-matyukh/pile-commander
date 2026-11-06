const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_SLOP_PX = 28

/**
 * Two quick taps of a finger or a pen in one place: a touch screen has no
 * reliable dblclick. A mouse is left to its own dblclick.
 */
export function useDoubleTap(onDoubleTap: (event: PointerEvent) => void) {
	let lastAt = 0
	let lastX = 0
	let lastY = 0
	let pointerId: number | null = null
	let startX = 0
	let startY = 0

	const far = (dx: number, dy: number) => dx * dx + dy * dy > DOUBLE_TAP_SLOP_PX * DOUBLE_TAP_SLOP_PX

	function onPointerDown(event: PointerEvent) {
		if (event.pointerType === 'mouse') return
		pointerId = event.pointerId
		startX = event.clientX
		startY = event.clientY
	}

	function onPointerUp(event: PointerEvent) {
		if (event.pointerType === 'mouse' || pointerId !== event.pointerId) return
		pointerId = null
		// A drag is no tap
		if (far(event.clientX - startX, event.clientY - startY)) {
			lastAt = 0
			return
		}
		const now = performance.now()
		if (lastAt > 0 && now - lastAt <= DOUBLE_TAP_MS && !far(event.clientX - lastX, event.clientY - lastY)) {
			lastAt = 0
			event.preventDefault()
			event.stopPropagation()
			onDoubleTap(event)
			return
		}
		lastAt = now
		lastX = event.clientX
		lastY = event.clientY
	}

	function onPointerCancel() {
		pointerId = null
		lastAt = 0
	}

	return { onPointerDown, onPointerUp, onPointerCancel }
}

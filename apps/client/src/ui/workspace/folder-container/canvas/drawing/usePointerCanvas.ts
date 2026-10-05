import { onUnmounted, type Ref } from 'vue'
import type { EditorTool, Point } from './types'

interface PointerCanvasOptions {
	tool: Ref<EditorTool>
	isPinching: Ref<boolean>
	paneEl: Ref<HTMLElement | null>
	screenToFlow: (clientX: number, clientY: number) => Point
	onStrokeStart: (point: Point) => void
	onStrokeExtend: (point: Point) => void
	onStrokeEnd: () => void
	onStrokeCancel: () => void
}

/** Pen/lasso input: Touch Events for fingers, Pointer Events for mouse/stylus. */
export function usePointerCanvas(options: PointerCanvasOptions) {
	const listenerOpts: AddEventListenerOptions = { passive: false, capture: true }

	let activePointerId: number | null = null
	let activeTouchId: number | null = null
	let captureEl: HTMLElement | null = null
	let trackingPointer = false
	let trackingTouch = false
	/** Block ghost mouse events that follow a touch on mobile browsers. */
	let suppressMouseUntil = 0

	function clientToFlow(clientX: number, clientY: number): Point {
		return options.screenToFlow(clientX, clientY)
	}

	function isDrawTool(): boolean {
		const t = options.tool.value
		return t === 'pen' || t === 'lasso'
	}

	function targetInPane(target: EventTarget | null): boolean {
		const pane = options.paneEl.value
		return Boolean(pane && target instanceof Element && pane.contains(target))
	}

	function startPointerTracking() {
		if (trackingPointer) return
		window.addEventListener('pointermove', onPointerMove, listenerOpts)
		window.addEventListener('pointerup', onPointerUp, listenerOpts)
		window.addEventListener('pointercancel', onPointerCancel, listenerOpts)
		trackingPointer = true
	}

	function stopPointerTracking() {
		if (!trackingPointer) return
		window.removeEventListener('pointermove', onPointerMove, listenerOpts)
		window.removeEventListener('pointerup', onPointerUp, listenerOpts)
		window.removeEventListener('pointercancel', onPointerCancel, listenerOpts)
		trackingPointer = false
	}

	function startTouchTracking() {
		if (trackingTouch) return
		window.addEventListener('touchmove', onTouchMove, listenerOpts)
		window.addEventListener('touchend', onTouchEnd, listenerOpts)
		window.addEventListener('touchcancel', onTouchEnd, listenerOpts)
		trackingTouch = true
	}

	function stopTouchTracking() {
		if (!trackingTouch) return
		window.removeEventListener('touchmove', onTouchMove, listenerOpts)
		window.removeEventListener('touchend', onTouchEnd, listenerOpts)
		window.removeEventListener('touchcancel', onTouchEnd, listenerOpts)
		trackingTouch = false
	}

	function releaseCapture(pointerId: number) {
		if (!captureEl) return
		try {
			if (captureEl.hasPointerCapture(pointerId)) {
				captureEl.releasePointerCapture(pointerId)
			}
		} catch {
			/* already released */
		}
		captureEl = null
	}

	function endPointerStroke(commit: boolean) {
		const pointerId = activePointerId
		activePointerId = null
		if (pointerId !== null) releaseCapture(pointerId)
		stopPointerTracking()
		if (commit) options.onStrokeEnd()
		else options.onStrokeCancel()
	}

	function endTouchStroke(commit: boolean) {
		activeTouchId = null
		stopTouchTracking()
		suppressMouseUntil = performance.now() + 700
		if (commit) options.onStrokeEnd()
		else options.onStrokeCancel()
	}

	function onPointerDown(event: PointerEvent) {
		if (event.pointerType === 'touch') return
		if (!isDrawTool()) return
		if (options.isPinching.value) return
		if (!event.isPrimary) return
		// Left mouse / stylus tip only. Right-click must not start a one-point stroke.
		if (event.button !== 0) return
		if (performance.now() < suppressMouseUntil) return
		if (activePointerId !== null || activeTouchId !== null) return

		const pane = options.paneEl.value
		if (!pane || !targetInPane(event.target)) return

		event.preventDefault()
		event.stopPropagation()

		activePointerId = event.pointerId
		captureEl = pane
		try {
			pane.setPointerCapture(event.pointerId)
		} catch {
			/* ignore */
		}
		startPointerTracking()
		options.onStrokeStart(clientToFlow(event.clientX, event.clientY))
	}

	function onPointerMove(event: PointerEvent) {
		if (activePointerId !== event.pointerId) return
		event.preventDefault()
		event.stopPropagation()
		options.onStrokeExtend(clientToFlow(event.clientX, event.clientY))
	}

	function onPointerUp(event: PointerEvent) {
		if (activePointerId !== event.pointerId) return
		const wasLasso = options.tool.value === 'lasso'
		event.preventDefault()
		event.stopPropagation()
		endPointerStroke(true)
		if (wasLasso) {
			const handler = (e: MouseEvent) => {
				e.preventDefault()
				e.stopPropagation()
				e.stopImmediatePropagation()
			}
			window.addEventListener('click', handler, { capture: true, once: true })
		}
	}

	function onPointerCancel(event: PointerEvent) {
		if (activePointerId !== event.pointerId) return
		event.preventDefault()
		event.stopPropagation()
		endPointerStroke(true)
	}

	function onTouchStart(event: TouchEvent) {
		if (!isDrawTool()) return
		if (options.isPinching.value) return
		if (activePointerId !== null) return

		if (event.touches.length !== 1) {
			if (activeTouchId !== null) endTouchStroke(true)
			return
		}

		const touch = event.changedTouches[0]
		if (!touch || !targetInPane(event.target)) return

		event.preventDefault()
		event.stopPropagation()

		activeTouchId = touch.identifier
		startTouchTracking()
		options.onStrokeStart(clientToFlow(touch.clientX, touch.clientY))
	}

	function findActiveTouch(list: TouchList): Touch | null {
		if (activeTouchId === null) return null
		for (let i = 0; i < list.length; i++) {
			const t = list.item(i)
			if (t && t.identifier === activeTouchId) return t
		}
		return null
	}

	function onTouchMove(event: TouchEvent) {
		if (activeTouchId === null) return
		if (event.touches.length > 1) {
			endTouchStroke(true)
			return
		}
		const touch = findActiveTouch(event.touches) ?? findActiveTouch(event.changedTouches)
		if (!touch) return
		event.preventDefault()
		event.stopPropagation()
		options.onStrokeExtend(clientToFlow(touch.clientX, touch.clientY))
	}

	function onTouchEnd(event: TouchEvent) {
		if (activeTouchId === null) return
		const ended = findActiveTouch(event.changedTouches)
		if (!ended && findActiveTouch(event.touches)) return
		event.preventDefault()
		event.stopPropagation()
		endTouchStroke(true)
	}

	function attach(el: HTMLElement) {
		el.addEventListener('pointerdown', onPointerDown, listenerOpts)
		el.addEventListener('touchstart', onTouchStart, listenerOpts)
	}

	function detach(el: HTMLElement) {
		el.removeEventListener('pointerdown', onPointerDown, listenerOpts)
		el.removeEventListener('touchstart', onTouchStart, listenerOpts)
		if (activePointerId !== null) endPointerStroke(false)
		if (activeTouchId !== null) endTouchStroke(false)
	}

	let currentEl: HTMLElement | null = null

	function bindPane(el: HTMLElement | null) {
		if (currentEl) detach(currentEl)
		currentEl = el
		if (el) attach(el)
	}

	onUnmounted(() => {
		if (currentEl) detach(currentEl)
		stopPointerTracking()
		stopTouchTracking()
	})

	return { bindPane }
}

import { onUnmounted, ref, type Ref } from 'vue'
import type { BoardViewport } from './types'
import { ZOOM_MAX, ZOOM_MIN } from './types'

interface PinchZoomOptions {
	targetEl: Ref<HTMLElement | null>
	getViewport: () => BoardViewport
	setViewport: (viewport: BoardViewport) => void
	enabled: Ref<boolean>
	onGestureStart?: () => void
}

function touchDistance(touches: TouchList): number {
	const dx = touches[0].clientX - touches[1].clientX
	const dy = touches[0].clientY - touches[1].clientY
	return Math.hypot(dx, dy)
}

function touchCenter(touches: TouchList): { x: number; y: number } {
	return {
		x: (touches[0].clientX + touches[1].clientX) / 2,
		y: (touches[0].clientY + touches[1].clientY) / 2,
	}
}

function clampZoom(zoom: number): number {
	return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom))
}

function zoomAtScreenPoint(
	viewport: BoardViewport,
	screenX: number,
	screenY: number,
	newZoom: number,
): BoardViewport {
	const zoom = clampZoom(newZoom)
	const flowX = (screenX - viewport.x) / viewport.zoom
	const flowY = (screenY - viewport.y) / viewport.zoom
	return {
		x: screenX - flowX * zoom,
		y: screenY - flowY * zoom,
		zoom,
	}
}

export function usePinchZoom(options: PinchZoomOptions) {
	const isPinching = ref(false)
	const listenerOpts: AddEventListenerOptions = { passive: false, capture: true }

	let lastDistance: number | null = null
	let lastCenter: { x: number; y: number } | null = null

	function resetPinch() {
		isPinching.value = false
		lastDistance = null
		lastCenter = null
	}

	function beginPinch() {
		if (!isPinching.value) {
			options.onGestureStart?.()
		}
		isPinching.value = true
	}

	function isTouchOnTarget(event: TouchEvent): boolean {
		const el = options.targetEl.value
		if (!el || event.touches.length < 2) return false
		const t0 = event.touches[0].target
		const t1 = event.touches[1].target
		return (
			t0 instanceof Element &&
			t1 instanceof Element &&
			el.contains(t0) &&
			el.contains(t1)
		)
	}

	function onTouchStart(event: TouchEvent) {
		if (!options.enabled.value || event.touches.length !== 2) return
		if (!isTouchOnTarget(event)) return

		event.preventDefault()
		beginPinch()
		lastDistance = touchDistance(event.touches)
		lastCenter = touchCenter(event.touches)
	}

	function onTouchMove(event: TouchEvent) {
		if (!options.enabled.value) return

		if (event.touches.length !== 2) {
			if (isPinching.value) resetPinch()
			return
		}

		if (!isTouchOnTarget(event)) return

		event.preventDefault()
		beginPinch()

		const distance = touchDistance(event.touches)
		const center = touchCenter(event.touches)

		if (lastDistance === null || lastCenter === null) {
			lastDistance = distance
			lastCenter = center
			return
		}

		const scale = distance / lastDistance
		const viewport = options.getViewport()
		const zoomed = zoomAtScreenPoint(viewport, center.x, center.y, viewport.zoom * scale)

		options.setViewport({
			x: zoomed.x + (center.x - lastCenter.x),
			y: zoomed.y + (center.y - lastCenter.y),
			zoom: zoomed.zoom,
		})

		lastDistance = distance
		lastCenter = center
	}

	function onTouchEnd(event: TouchEvent) {
		if (event.touches.length < 2) {
			resetPinch()
		}
	}

	function attach(el: HTMLElement) {
		el.addEventListener('touchstart', onTouchStart, listenerOpts)
		el.addEventListener('touchmove', onTouchMove, listenerOpts)
		el.addEventListener('touchend', onTouchEnd, listenerOpts)
		el.addEventListener('touchcancel', onTouchEnd, listenerOpts)
	}

	function detach(el: HTMLElement) {
		el.removeEventListener('touchstart', onTouchStart, listenerOpts)
		el.removeEventListener('touchmove', onTouchMove, listenerOpts)
		el.removeEventListener('touchend', onTouchEnd, listenerOpts)
		el.removeEventListener('touchcancel', onTouchEnd, listenerOpts)
		resetPinch()
	}

	let currentEl: HTMLElement | null = null

	function bind(el: HTMLElement | null) {
		if (currentEl) detach(currentEl)
		currentEl = el
		if (el) attach(el)
	}

	onUnmounted(() => {
		if (currentEl) detach(currentEl)
	})

	return { isPinching, bind }
}

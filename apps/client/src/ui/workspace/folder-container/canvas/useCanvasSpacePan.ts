import { computed, onMounted, onUnmounted, ref, toValue, watch, type MaybeRefOrGetter, type Ref } from 'vue'
import { keys_elsewhere } from '@/ui/explorer/folder_keys'
import {
	SPACE_PAN_IDLE,
	is_space,
	space_pan_next,
	starts_space_pan,
	type SpacePanEvent,
	type SpacePanState,
} from './canvasSpacePan'

/** Space on one of these presses it: a button reached with Tab, a link, a menu item */
const OWN_SPACE = [
	'button',
	'a[href]',
	'summary',
	'[role="menuitem"]',
	'[role="menuitemcheckbox"]',
	'[role="option"]',
	'[role="checkbox"]',
	'[role="radio"]',
	'[role="switch"]',
	'[role="tab"]',
].join(', ')

/**
 * While Space is held the canvas moves under a drag, as with Hand, and the
 * tool comes back on release. Text being typed, an open menu or dialog and a
 * focused button keep their Space.
 */
export function useCanvasSpacePan(options: {
	enabled: MaybeRefOrGetter<boolean>
	/** The canvas itself: a press on it is a gesture Space must not cut into */
	area: Ref<HTMLElement | null>
}) {
	const state = ref<SpacePanState>(SPACE_PAN_IDLE)

	function send(event: SpacePanEvent) {
		state.value = space_pan_next(state.value, event)
	}

	function onKeyDown(event: KeyboardEvent) {
		if (state.value.held) {
			if (!is_space(event)) return
			// The key repeats while held: nothing scrolls and nothing gets pressed
			event.preventDefault()
			event.stopPropagation()
			if (!event.repeat) send('key_down')
			return
		}
		if (!starts_space_pan(event) || event.repeat || event.defaultPrevented) return
		if (!toValue(options.enabled)) return
		if (keys_elsewhere(event)) return
		if (event.target instanceof Element && event.target.closest(OWN_SPACE)) return
		send('key_down')
		if (!state.value.held) return
		event.preventDefault()
		// Vue Flow takes Space on a focused card as "select it"
		event.stopPropagation()
	}

	function onKeyUp(event: KeyboardEvent) {
		if (!state.value.held || !is_space(event)) return
		event.preventDefault()
		event.stopPropagation()
		send('key_up')
	}

	function onPointerDown(event: PointerEvent) {
		const area = options.area.value
		if (area && event.target instanceof Node && area.contains(event.target)) send('pointer_down')
	}

	function onPointerUp() {
		send('pointer_up')
	}

	// The key up never comes when the window loses focus while Space is down
	function reset() {
		send('reset')
	}

	function onVisibilityChange() {
		if (document.hidden) reset()
	}

	watch(() => toValue(options.enabled), (enabled) => {
		if (!enabled) reset()
	})

	onMounted(() => {
		// Capture: before a focused card or button sees the key
		window.addEventListener('keydown', onKeyDown, true)
		window.addEventListener('keyup', onKeyUp, true)
		window.addEventListener('pointerdown', onPointerDown, true)
		window.addEventListener('pointerup', onPointerUp, true)
		window.addEventListener('pointercancel', onPointerUp, true)
		window.addEventListener('blur', reset)
		document.addEventListener('visibilitychange', onVisibilityChange)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown, true)
		window.removeEventListener('keyup', onKeyUp, true)
		window.removeEventListener('pointerdown', onPointerDown, true)
		window.removeEventListener('pointerup', onPointerUp, true)
		window.removeEventListener('pointercancel', onPointerUp, true)
		window.removeEventListener('blur', reset)
		document.removeEventListener('visibilitychange', onVisibilityChange)
	})

	return {
		held: computed(() => state.value.held),
	}
}

import { onMounted, onUnmounted, ref } from 'vue'
import { hides_pointer_on_claimed_key } from '@/services/window/pointerAutohide'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { useBoardPlacement } from './board/boardShapePlacement'
import { isTypingTarget } from './useLineDrawMode'

type UseTextPlaceModeOptions = {
	/** Embedded folder previews ignore the hotkey. */
	isEmbedded: boolean
	/**
	 * The canvas arms it only with a tool that clicks on the pane (hand,
	 * select): with the pen or the lasso a click is a stroke. Default: always.
	 */
	canArm?: () => boolean
	/** Right before the mode turns on: the canvas steps to a tool whose click is free for the text */
	beforeArm?: () => void
}

/** Claiming a key hides the pointer here until the mouse moves */
const pointerHides = typeof navigator !== 'undefined' && hides_pointer_on_claimed_key(navigator.userAgent)

/**
 * One-shot text placement armed by the keyboard: T arms it, the next click on
 * empty pane drops a text block there (the pane's click handler reads
 * `armed`). Escape or pressing T again cancels. Board and canvas.
 */
export function useTextPlaceMode(options: UseTextPlaceModeOptions) {
	const { clearBoardPlacement } = useBoardPlacement()
	const workspace = useWorkspace()
	const armed = ref(false)

	function arm() {
		armed.value = true
		clearBoardPlacement()
	}

	function disarm() {
		armed.value = false
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.defaultPrevented) return
		if (event.repeat) return
		if (isTypingTarget(event.target)) return
		if (event.metaKey || event.ctrlKey || event.altKey) return

		if (event.key === 'Escape') {
			if (armed.value) {
				event.preventDefault()
				disarm()
			}
			return
		}
		// `code` as well as `key`: a non-Latin layout types another letter on this key.
		if (event.code !== 'KeyT' && event.key.toLowerCase() !== 't') return
		if (workspace.value?.can_write === false) return

		if (armed.value) disarm()
		else if (options.canArm?.() ?? true) {
			options.beforeArm?.()
			arm()
		}
		else return
		// T only changes the cursor, so the cursor has to show at once. Where
		// claiming the key would hide the pointer, the key is left unclaimed: a
		// letter does nothing by default outside a text field, and no other
		// hotkey answers to T.
		if (!pointerHides) event.preventDefault()
	}

	onMounted(() => {
		if (options.isEmbedded) return
		window.addEventListener('keydown', onKeyDown)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown)
	})

	return { armed, disarm }
}

import { onUnmounted, ref } from 'vue'
import { onClickOutside, useMediaQuery } from '@vueuse/core'

const LEAVE_DELAY_MS = 120

/**
 * Hover-opens on fine pointers, click-toggles on coarse (touch).
 * Shared by the canvas zoom readout and the compact tool picker.
 */
export function useHoverClickMenu() {
	const isCoarsePointer = useMediaQuery('(pointer: coarse)')
	const menuRef = ref<HTMLElement | null>(null)
	const open = ref(false)
	let closeTimer: ReturnType<typeof setTimeout> | null = null

	function clearCloseTimer() {
		if (!closeTimer) return
		clearTimeout(closeTimer)
		closeTimer = null
	}

	function openIfFine() {
		if (isCoarsePointer.value) return
		clearCloseTimer()
		open.value = true
	}

	function closeIfFine() {
		if (isCoarsePointer.value) return
		clearCloseTimer()
		closeTimer = setTimeout(() => {
			open.value = false
			closeTimer = null
		}, LEAVE_DELAY_MS)
	}

	function onFocusOut(event: FocusEvent) {
		if (isCoarsePointer.value) return
		const next = event.relatedTarget as Node | null
		if (next && menuRef.value?.contains(next)) return
		closeIfFine()
	}

	function toggleIfCoarse() {
		if (!isCoarsePointer.value) return
		open.value = !open.value
	}

	function close() {
		open.value = false
	}

	function closeIfCoarse() {
		if (isCoarsePointer.value) open.value = false
	}

	onClickOutside(menuRef, () => {
		if (!isCoarsePointer.value) return
		open.value = false
	})

	onUnmounted(() => {
		clearCloseTimer()
	})

	return {
		isCoarsePointer,
		menuRef,
		open,
		openIfFine,
		closeIfFine,
		onFocusOut,
		toggleIfCoarse,
		close,
		closeIfCoarse,
	}
}

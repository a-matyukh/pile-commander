import { computed, nextTick, onMounted, ref, watch, type WatchSource } from 'vue'
import { useEventListener } from '@vueuse/core'

export type PanelAnchor = { el: HTMLElement; align: 'start' | 'end' } | null

/**
 * Places a panel under an anchor inside `.explorer`. With no anchor, the
 * header actions row (or the title row) stands in, the same fallback the
 * export panel uses.
 */
export function use_anchored_panel(anchor: () => PanelAnchor, pulse: WatchSource) {
	const place = ref<{ top: number; left: number | null; right: number | null }>({ top: 44, left: null, right: 12 })

	function fallback_row(host: HTMLElement): HTMLElement | null {
		const actions = host.querySelector('.rg')
		if (actions instanceof HTMLElement) return actions
		const row = host.querySelector('.hrow')
		return row instanceof HTMLElement ? row : null
	}

	function measure() {
		const host = document.querySelector('.explorer')
		if (!(host instanceof HTMLElement)) return
		const host_box = host.getBoundingClientRect()
		const current = anchor()
		const target = current?.el ?? fallback_row(host)
		if (!target) return
		const rect = target.getBoundingClientRect()
		const top = rect.bottom - host_box.top + 6
		if (current?.align === 'start') {
			place.value = { top, left: rect.left - host_box.left, right: null }
			return
		}
		place.value = { top, left: null, right: host_box.right - rect.right }
	}

	onMounted(measure)
	watch(pulse, () => nextTick(measure))
	watch(anchor, () => nextTick(measure))
	useEventListener(window, 'resize', measure)

	const style = computed(() => ({
		top: `${place.value.top}px`,
		left: place.value.left == null ? 'auto' : `${place.value.left}px`,
		right: place.value.right == null ? 'auto' : `${place.value.right}px`,
	}))

	return { style }
}

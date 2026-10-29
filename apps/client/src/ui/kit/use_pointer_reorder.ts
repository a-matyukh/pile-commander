import { useEventListener } from '@vueuse/core'
import type { Ref } from 'vue'

type Options = {
	container: Ref<HTMLElement | null | undefined>
	/** Selector of a draggable item; it carries its key in `data-key` */
	item: string
	/** Only start dragging from this part of the item */
	handle?: string
	axis: 'x' | 'y'
	on_move: (key: string, target_key: string, after: boolean) => void
}

/**
 * Reorder by dragging with mouse or touch. While dragging, the item gets
 * `.dragging` and the drop target `.drop-before` / `.drop-after`, which
 * the component styles as an insertion line. The click that ends a drag
 * never reaches the item. While dragging, nothing on the page gets selected
 * and the cursor is a closed hand.
 */
export function use_pointer_reorder(o: Options) {
	type Drag = { el: HTMLElement; x: number; y: number; on: boolean; target?: { key: string; after: boolean } }
	let drag: Drag | null = null

	const swallow_click = (e: MouseEvent) => {
		e.stopPropagation()
		e.preventDefault()
	}

	const clear_marks = () =>
		o.container.value?.querySelectorAll('.drop-before, .drop-after').forEach(el => el.classList.remove('drop-before', 'drop-after'))

	useEventListener(o.container, 'pointerdown', (e: PointerEvent) => {
		if (e.button > 0) return
		const t = e.target as HTMLElement
		if (o.handle && !t.closest(o.handle)) return
		const el = t.closest<HTMLElement>(o.item)
		if (!el?.dataset.key) return
		drag = { el, x: e.clientX, y: e.clientY, on: false }
	})

	useEventListener(
		window,
		'pointermove',
		(e: PointerEvent) => {
			if (!drag) return
			if (!drag.on) {
				if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 6) return
				drag.on = true
				drag.el.classList.add('dragging')
				document.documentElement.classList.add('reordering')
				window.getSelection()?.removeAllRanges()
				// armed now, not on pointerup: an item can turn pointerup into a click
				window.addEventListener('click', swallow_click, true)
			}
			e.preventDefault()
			clear_marks()
			drag.target = undefined
			const over = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>(o.item)
			if (!over || over === drag.el || !o.container.value?.contains(over) || !over.dataset.key) return
			const r = over.getBoundingClientRect()
			const before = o.axis === 'x' ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2
			over.classList.add(before ? 'drop-before' : 'drop-after')
			drag.target = { key: over.dataset.key, after: !before }
		},
		{ passive: false },
	)

	const finish = (apply: boolean) => {
		if (!drag) return
		const d = drag
		drag = null
		if (!d.on) return
		d.el.classList.remove('dragging')
		document.documentElement.classList.remove('reordering')
		clear_marks()
		if (apply && d.target && d.el.dataset.key) o.on_move(d.el.dataset.key, d.target.key, d.target.after)
		setTimeout(() => window.removeEventListener('click', swallow_click, true), 0)
	}

	useEventListener(window, 'pointerup', () => finish(true))
	useEventListener(window, 'pointercancel', () => finish(false))
}

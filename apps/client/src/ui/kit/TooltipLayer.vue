<script setup lang="ts">
import { nextTick, reactive, ref } from 'vue'
import { useEventListener } from '@vueuse/core'

/**
 * One tooltip for the whole app. Any element with `data-tip` gets it;
 * `data-tip-key` adds a keyboard shortcut on the right.
 *
 * A layer instead of a wrapper component: menu triggers are `as-child`
 * slots and need the button itself as their root.
 *
 * - shows after 300 ms; moving to a neighbor within 300 ms of leaving
 *   shows the next one at once
 * - also on keyboard focus; never on touch
 * - hidden on press, on scroll, and while the element's menu is open
 * - menu items get it too (a hint on what the item does)
 */
const DELAY = 300
const WARM_FOR = 300

const tip = reactive({ text: '', key: '', x: 0, y: 0, visible: false, measured: false, beside: false })
const box = ref<HTMLElement | null>(null)

let timer: ReturnType<typeof setTimeout> | undefined
let current: HTMLElement | null = null
let warm_until = 0
/** Pressed: no tooltip until the pointer leaves this element */
let pressed = false

const menu_open = (el: HTMLElement) =>
	el.getAttribute('aria-expanded') === 'true' || el.dataset.state === 'open'

async function show(el: HTMLElement) {
	if (!el.isConnected || menu_open(el)) return
	tip.text = el.dataset.tip ?? ''
	tip.key = el.dataset.tipKey ?? ''
	tip.beside = el.getAttribute('role') === 'menuitem'
	if (!tip.text) return
	tip.measured = false
	tip.visible = true
	await nextTick()
	const b = box.value
	if (!b) return
	const r = el.getBoundingClientRect()
	const w = b.offsetWidth
	const h = b.offsetHeight
	if (tip.beside) {
		// beside a menu item, not over its neighbors: right, or left when there is no room
		tip.x = r.right + 8 + w > innerWidth - 8 ? Math.max(8, r.left - 8 - w) : r.right + 8
		tip.y = r.top + r.height / 2 - h / 2
	} else {
		tip.x = Math.min(Math.max(8, r.left + r.width / 2 - w / 2), innerWidth - w - 8)
		// below the element; above when there is no room
		tip.y = r.bottom + 6 + h > innerHeight - 8 ? r.top - 6 - h : r.bottom + 6
	}
	tip.measured = true
}

function hide() {
	clearTimeout(timer)
	if (tip.visible) warm_until = Date.now() + WARM_FOR
	tip.visible = false
}

useEventListener(document, 'pointerover', (e: PointerEvent) => {
	if (e.pointerType === 'touch') return
	const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
	if (el === current) return
	hide()
	current = el
	pressed = false
	if (!el) return
	if (Date.now() < warm_until) void show(el)
	else timer = setTimeout(() => current === el && !pressed && void show(el), DELAY)
})

useEventListener(document, 'pointerdown', () => {
	pressed = true
	hide()
	warm_until = 0
})

useEventListener(document, 'focusin', (e: FocusEvent) => {
	const el = e.target as HTMLElement
	if (el.dataset?.tip && el.matches(':focus-visible')) {
		current = el
		void show(el)
	}
})

// Only the element's own focus loss: a menu moves focus onto the hovered
// item, which must not cancel that item's tooltip
useEventListener(document, 'focusout', (e: FocusEvent) => {
	if (e.target === current) hide()
})
useEventListener(document, 'scroll', hide, { capture: true, passive: true })
useEventListener(document, 'keydown', hide)
</script>

<template>
	<div
		v-if="tip.visible"
		ref="box"
		class="tip"
		:class="{ beside: tip.beside }"
		role="tooltip"
		:style="{ left: tip.x + 'px', top: tip.y + 'px', visibility: tip.measured ? 'visible' : 'hidden' }"
	>
		{{ tip.text }}<span v-if="tip.key" class="kb">{{ tip.key }}</span>
	</div>
</template>

<style scoped>
.tip {
	position: fixed;
	z-index: 100;
	pointer-events: none;
	white-space: nowrap;
	background: #1F1F1E;
	color: #fff;
	font-size: 12px;
	line-height: 1;
	padding: 6px 8px;
	border-radius: 6px;
}
.kb {
	font-family: var(--font-mono);
	font-size: 11px;
	margin-left: 8px;
	opacity: .6;
}
.explorer.lg .tip {
	font-size: 13px;
}
.tip.beside {
	white-space: normal;
	max-width: 220px;
	line-height: 1.3;
}
</style>

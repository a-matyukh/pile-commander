<script setup lang="ts">
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { t } from '@/i18n'
import {
	explorer_sidebar_open,
	explorer_sidebar_width,
	SIDEBAR_COLLAPSE_UNDER,
	SIDEBAR_MAX,
	SIDEBAR_MIN,
} from '@/store/explorer/sidebar'

/** Drag the right edge to resize; double click returns the default width */
const dragging = ref(false)
let start_x = 0
let start_width = 0

function start(e: PointerEvent) {
	if (e.button > 0) return
	const aside = (e.currentTarget as HTMLElement).parentElement
	if (!aside) return
	e.preventDefault()
	start_x = e.clientX
	start_width = aside.getBoundingClientRect().width
	dragging.value = true
	document.body.style.cursor = 'col-resize'
}

useEventListener(window, 'pointermove', (e: PointerEvent) => {
	if (!dragging.value) return
	const next = start_width + e.clientX - start_x
	if (next < SIDEBAR_COLLAPSE_UNDER) {
		stop()
		explorer_sidebar_open.value = false
		return
	}
	explorer_sidebar_width.value = Math.round(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, next)))
})

function stop() {
	dragging.value = false
	document.body.style.cursor = ''
}

useEventListener(window, 'pointerup', () => dragging.value && stop())
useEventListener(window, 'pointercancel', () => dragging.value && stop())
</script>

<template>
	<div
		class="rz"
		:class="{ on: dragging }"
		:data-tip="dragging ? undefined : t('sidebar.resize_hint')"
		@pointerdown="start"
		@dblclick="explorer_sidebar_width = null"
	/>
</template>

<style scoped>
.rz {
	position: absolute;
	top: 0;
	bottom: 0;
	right: -4px;
	width: 8px;
	z-index: 2;
	cursor: col-resize;
	touch-action: none;
}
.rz::after {
	content: '';
	position: absolute;
	top: 0;
	bottom: 0;
	left: 3px;
	width: 2px;
	background: transparent;
	transition: background .12s;
}
.rz.on::after {
	background: var(--border-stronger);
}
@media (hover: hover) {
	.rz:hover::after {
		background: var(--border-stronger);
	}
}
</style>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { t } from '@/i18n'
import store from '@/store'
import { report_error } from '@/store/helpers/reportError'
import {
	dismiss_pile_export,
	export_anchor,
	pile_export,
	pile_export_saved,
	pile_export_status,
	reveal_exported_pile,
} from '@/store/explorer/exportPile'
import IconButton from '@/ui/kit/IconButton.vue'

const current = computed(() => pile_export.current)
const place = ref<{ top: number; left: number | null; right: number | null }>({ top: 44, left: null, right: 12 })

const fraction = computed(() => {
	const state = current.value
	if (!state || state.phase !== 'downloading' || state.total <= 0) return null
	return Math.min(1, state.done / state.total)
})
const status = computed(() => (current.value ? pile_export_status(current.value) : ''))
const saved = computed(() => (current.value ? pile_export_saved(current.value) : null))

const style = computed(() => ({
	top: `${place.value.top}px`,
	left: place.value.left == null ? 'auto' : `${place.value.left}px`,
	right: place.value.right == null ? 'auto' : `${place.value.right}px`,
}))

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
	const anchor = export_anchor.value
	const target = anchor?.el ?? fallback_row(host)
	if (!target) return
	const rect = target.getBoundingClientRect()
	const top = rect.bottom - host_box.top + 6
	if (anchor?.align === 'start') {
		place.value = { top, left: rect.left - host_box.left, right: null }
		return
	}
	place.value = { top, left: null, right: host_box.right - rect.right }
}

onMounted(measure)
watch([export_anchor, () => pile_export.current], () => nextTick(measure))
useEventListener(window, 'resize', measure)

async function reveal() {
	try {
		await reveal_exported_pile()
	} catch (error) {
		report_error(store, error)
	}
}
</script>

<template>
	<div
		v-if="current"
		class="panel"
		role="status"
		aria-live="polite"
		:style="style"
	>
		<div class="hd">
			<span class="title">{{ t('export.title') }}</span>
			<IconButton
				icon="tabler:x"
				:icon_size="16"
				:aria-label="t('dialog.close')"
				@click="dismiss_pile_export"
			/>
		</div>
		<div class="folder">{{ current.folder_name }}</div>
		<p :class="{ err: current.phase === 'error' }">{{ status }}</p>
		<p v-if="saved">{{ saved }}</p>
		<button v-if="current.phase === 'done' && current.path" type="button" class="finder" @click="reveal">
			{{ t('export.show_in_finder') }}
		</button>
		<div v-if="current.phase === 'preparing' || current.phase === 'packing'" class="track" aria-hidden="true">
			<div class="fill slide" />
		</div>
		<div v-else-if="fraction !== null" class="track" aria-hidden="true">
			<div class="fill" :style="{ width: `${fraction * 100}%` }" />
		</div>
	</div>
</template>

<style scoped>
.panel {
	position: absolute;
	z-index: 40;
	width: 230px;
	box-sizing: border-box;
	padding: 10px 10px 12px;
	background: var(--surface-3);
	border: 0.5px solid var(--border-strong);
	border-radius: 8px;
	color: var(--text-primary);
	font-size: 13px;
	box-shadow: 0 8px 24px rgba(0, 0, 0, .1), 0 2px 6px rgba(0, 0, 0, .06);
}
:global(.explorer.lg) .panel {
	width: 250px;
	font-size: 15px;
}
.hd {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}
.title {
	font-weight: 600;
}
.folder {
	margin-top: 4px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
p {
	margin: 6px 0 0;
	color: var(--text-muted, #9A9893);
}
p.err {
	color: var(--text-danger, #b42318);
}
.finder {
	margin-top: 8px;
	padding: 0;
	border: 0;
	background: none;
	color: var(--text-primary);
	font: inherit;
	cursor: pointer;
	text-decoration: underline;
	text-underline-offset: 2px;
}
.track {
	height: 4px;
	margin-top: 10px;
	border-radius: 999px;
	background: var(--border);
	overflow: hidden;
}
.fill {
	height: 100%;
	border-radius: inherit;
	background: var(--accent, currentColor);
}
.fill.slide {
	width: 40%;
	animation: export-slide 1.1s ease-in-out infinite;
}
@keyframes export-slide {
	0% { transform: translateX(-120%); }
	100% { transform: translateX(280%); }
}
</style>

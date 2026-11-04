<script setup lang="ts">
import { computed } from 'vue'
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
import PanelFrame from './PanelFrame.vue'
import PanelTrack from './PanelTrack.vue'
import { use_anchored_panel } from './useAnchoredPanel'

const current = computed(() => pile_export.current)

const fraction = computed(() => {
	const state = current.value
	if (!state || state.phase !== 'downloading' || state.total <= 0) return null
	return Math.min(1, state.done / state.total)
})
const status = computed(() => (current.value ? pile_export_status(current.value) : ''))
const saved = computed(() => (current.value ? pile_export_saved(current.value) : null))

const { style } = use_anchored_panel(() => export_anchor.value, () => pile_export.current)

async function reveal() {
	try {
		await reveal_exported_pile()
	} catch (error) {
		report_error(store, error)
	}
}
</script>

<template>
	<PanelFrame
		v-if="current"
		kind="export"
		:title="t('export.title')"
		:style="style"
		@close="dismiss_pile_export"
	>
		<div class="folder">{{ current.folder_name }}</div>
		<p :class="{ err: current.phase === 'error' }">{{ status }}</p>
		<p v-if="saved">{{ saved }}</p>
		<button v-if="current.phase === 'done' && current.path" type="button" class="finder" @click="reveal">
			{{ t('export.show_in_finder') }}
		</button>
		<PanelTrack v-if="current.phase === 'preparing' || current.phase === 'packing'" :fraction="null" />
		<PanelTrack v-else-if="fraction !== null" :fraction="fraction" />
	</PanelFrame>
</template>

<style scoped>
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
</style>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { t } from '@/i18n'
import { is_spatial_folder } from '@/services/workspace/spatialFolder'
import { explorer_mobile } from '@/store/explorer/sidebar'
import {
	LAYERS_PANEL_COLLAPSE_UNDER,
	LAYERS_PANEL_DEFAULT,
	LAYERS_PANEL_MAX,
	LAYERS_PANEL_MIN,
	layers_docked,
	layers_panel_open,
	layers_panel_width,
	undock_layers,
} from '@/store/explorer/layers_panel'
import IconButton from '@/ui/kit/IconButton.vue'
import LayersList from './folder-header/LayersList.vue'
import { use_folder_place } from './folder-header/use_folder_place'

/**
 * The layers of the open board or canvas, pinned to the right of the content
 * (a wide window only). Shown on the same folders as the layers button.
 * Its left edge drags to resize, as the left sidebar's right edge does
 */
const { location, workspace } = use_folder_place()

const shown = computed(() => {
	const ws = workspace.value
	const folder = location.value
	return !!ws && !!folder && layers_docked.value && layers_panel_open.value && !explorer_mobile.value
		&& ws.can_write && is_spatial_folder(ws, folder.folder_id)
})

const width = computed(() => layers_panel_width.value ?? LAYERS_PANEL_DEFAULT)

const resizing = ref(false)
let start_x = 0
let start_width = 0

function start_resize(event: PointerEvent) {
	if (event.button > 0) return
	event.preventDefault()
	start_x = event.clientX
	start_width = width.value
	resizing.value = true
	document.body.style.cursor = 'col-resize'
}

function stop_resize() {
	resizing.value = false
	document.body.style.cursor = ''
}

useEventListener(window, 'pointermove', (event: PointerEvent) => {
	if (!resizing.value) return
	const next = start_width + start_x - event.clientX
	if (next < LAYERS_PANEL_COLLAPSE_UNDER) {
		stop_resize()
		layers_panel_open.value = false
		return
	}
	layers_panel_width.value = Math.round(Math.min(LAYERS_PANEL_MAX, Math.max(LAYERS_PANEL_MIN, next)))
})
useEventListener(window, 'pointerup', () => resizing.value && stop_resize())
useEventListener(window, 'pointercancel', () => resizing.value && stop_resize())
</script>

<template>
	<aside v-if="shown && workspace && location" class="lp" :style="{ width: `${width}px` }" :aria-label="t('actions.layers')">
		<div
			class="rz"
			:class="{ on: resizing }"
			:data-tip="resizing ? undefined : t('sidebar.resize_hint')"
			@pointerdown="start_resize"
			@dblclick="layers_panel_width = null"
		/>
		<header class="lh">
			<span class="tl">{{ t('layers.title') }}</span>
			<IconButton
				icon="tabler:layout-sidebar-right-collapse"
				:label="t('layers.undock')"
				@click="undock_layers"
			/>
		</header>
		<div class="lb">
			<LayersList :key="location.folder_id" :workspace="workspace" :folder="location" as="panel" />
		</div>
	</aside>
</template>

<style scoped>
.lp {
	position: relative;
	flex: none;
	display: flex;
	flex-direction: column;
	min-height: 0;
	border-left: 0.5px solid var(--border);
	background: var(--pn);
}
.lh {
	display: flex;
	align-items: center;
	gap: 8px;
	min-height: 36px;
	padding: 0 8px 0 12px;
	font-size: 11px;
	color: var(--text-muted);
}
.explorer.lg .lh {
	font-size: 12px;
	min-height: 44px;
}
.tl {
	flex: 1;
}
.lb {
	flex: 1;
	min-height: 0;
	overflow: auto;
	padding: 0 6px 8px;
}
.rz {
	position: absolute;
	top: 0;
	bottom: 0;
	left: -4px;
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

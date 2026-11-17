<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { record_action } from '@/store/history'
import { DEFAULT_GRID_SIZE } from '@/services/board/layout'
import { set_pile_image } from '@/services/workspace/choosePileImage'
import { to_folder_container } from '@/services/workspace/folderContainer'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import MenuSub from '@/ui/kit/MenuSub.vue'
import ColorPanel from './ColorPanel.vue'

/**
 * A board's or a canvas's grid and background, as the board's context menu
 * has them: "Grid" (snapping, the grid size, dots and axes on a canvas) and
 * "Background" (the folder's color or picture, a reset)
 */
const props = defineProps<{ workspace: WorkspaceStore; folder_id: string }>()

const container = computed(() => {
	const folder = props.workspace.folders[props.folder_id]
	return folder ? to_folder_container(folder, props.workspace.preview_folders) : null
})
const canvas = computed(() => container.value?.view === 'canvas')
const grid_size = computed(() => container.value?.grid_size ?? DEFAULT_GRID_SIZE)
const GRID_SIZES = [10, 20, 40, 80]

const ws = () => props.workspace

/** Any size of one's own, written on Enter or when the field is left */
const custom_size = ref(String(grid_size.value))
watch(grid_size, (size) => { custom_size.value = String(size) })

function apply_size() {
	const size = Math.round(Number(custom_size.value))
	if (!Number.isFinite(size) || size < 1) {
		custom_size.value = String(grid_size.value)
		return
	}
	if (size !== grid_size.value) void ws().change_grid_size(props.folder_id, size)
}

/** The folder's background: a color is one undo (a picture link stops undo before it) */
function set_background(value: string) {
	const store = ws()
	const folder_id = props.folder_id
	const next = value.trim() || 'none'
	void record_action(store, { folder_id }, t('undo.color'), tx => store.change_background(folder_id, next, { tx }))
}

async function choose_picture() {
	const folder_id = props.folder_id
	const store = ws()
	// on screen at once; the upload and the attribute follow
	await set_pile_image(store, folder_id, 'background', (token, after) => store.change_background(folder_id, token, { after }))
}
</script>

<template>
	<MenuSub icon="tabler:grid-dots" :label="t('board_menu.grid')" :width="240">
		<MenuItem
			icon="tabler:layout-align-middle"
			:label="t('background.snap')"
			:checked="container?.snap_to_grid ?? false"
			keep_open
			@select="ws().change_snap_to_grid(folder_id, !(container?.snap_to_grid ?? false))"
		/>
		<MenuSub icon="tabler:ruler-measure" :label="t('background.grid_size')" :width="150">
			<MenuItem
				v-for="size in GRID_SIZES"
				:key="size"
				:label="t('background.size', { n: size })"
				:checked="grid_size === size"
				@select="ws().change_grid_size(folder_id, size)"
			/>
			<MenuSeparator />
			<form class="gs" @submit.prevent="apply_size">
				<input
					v-model="custom_size"
					class="in"
					type="number"
					min="1"
					step="1"
					:aria-label="t('background.custom_size')"
					:placeholder="t('background.custom_size')"
					@change="apply_size"
					@keydown.stop
				>
				<span class="u">{{ t('background.size', { n: '' }).trim() }}</span>
			</form>
		</MenuSub>
		<template v-if="canvas">
			<MenuItem
				icon="tabler:grid-4x4"
				:label="t('background.dots')"
				:checked="container?.show_grid_dots ?? true"
				keep_open
				@select="ws().change_show_grid_dots(folder_id, !(container?.show_grid_dots ?? true))"
			/>
			<MenuItem
				icon="tabler:axis-x"
				:label="t('background.axes')"
				:checked="container?.show_axes ?? false"
				keep_open
				@select="ws().change_show_axes(folder_id, !(container?.show_axes ?? false))"
			/>
		</template>
	</MenuSub>
	<MenuSub icon="tabler:background" :label="t('board_menu.background')" :width="208">
		<ColorPanel
			:value="container?.background"
			:label="t('style.background_color')"
			picture
			:choose="workspace.pile_images === true"
			:reset_label="t('background.reset')"
			reset_always
			@set="set_background"
			@choose="choose_picture"
		/>
	</MenuSub>
</template>

<style scoped>
.gs {
	display: flex;
	align-items: center;
	gap: 6px;
	padding: 4px 8px 6px;
}
.in {
	box-sizing: border-box;
	width: 72px;
	height: 28px;
	padding: 0 8px;
	border: 0.5px solid var(--border-strong);
	border-radius: 6px;
	background: var(--surface-2);
	font: inherit;
	font-size: 12px;
	color: var(--text-primary);
	outline: none;
}
.in:focus {
	border-color: var(--border-accent);
}
.u {
	font-size: 12px;
	color: var(--text-muted);
}
</style>

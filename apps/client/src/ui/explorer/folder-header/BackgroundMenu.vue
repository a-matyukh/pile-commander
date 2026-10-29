<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { DEFAULT_GRID_SIZE } from '@/services/board/layout'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { PRESET_COLORS } from '@/ui/workspace/menu/useColorSubmenu'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import MenuSub from '@/ui/kit/MenuSub.vue'

/**
 * "Grid and background" of a board or a canvas, as in the prototype, with
 * the current app's settings: snapping and the grid size (dots and axes on a
 * canvas), the folder's background color, any color or picture link, a reset
 */
const props = defineProps<{ workspace: WorkspaceStore; folder_id: string; align: 'start' | 'end' }>()

const open = ref(false)

const container = computed(() => {
	const folder = props.workspace.folders[props.folder_id]
	return folder ? to_folder_container(folder, props.workspace.preview_folders) : null
})
const canvas = computed(() => container.value?.view === 'canvas')
const grid_size = computed(() => container.value?.grid_size ?? DEFAULT_GRID_SIZE)
const GRID_SIZES = [10, 20, 40, 80]

const ws = () => props.workspace

/**
 * Any CSS color or a picture's link, as the current app's field; empty
 * resets. A picture is not stored in the folder yet: a file in .pile comes
 * later (BACKLOG.md)
 */
const custom = ref('')
watch(open, (is_open) => {
	if (!is_open) return
	const current = container.value?.background
	custom.value = current && current !== 'none' && !current.startsWith('data:') ? current : ''
})

/**
 * The field takes the keys as soon as its submenu opens. The menu focuses
 * its own content on open, so the field takes the focus right after it
 */
const vFocus = { mounted: (el: HTMLElement) => { requestAnimationFrame(() => el.focus()) } }

function apply_custom() {
	const value = custom.value.trim()
	void ws().change_background(props.folder_id, value === '' ? 'none' : value)
	open.value = false
}
</script>

<template>
	<DropMenu v-model:open="open" :width="240" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:background"
				:icon_size="18"
				:aria-label="t('actions.background')"
				:data-tip="t('actions.background')"
			/>
		</template>
		<MenuLabel :label="t('background.grid')" />
		<MenuItem
			icon="tabler:layout-align-middle"
			:label="t('background.snap')"
			:checked="container?.snap_to_grid ?? false"
			keep_open
			@select="ws().change_snap_to_grid(folder_id, !(container?.snap_to_grid ?? false))"
		/>
		<MenuSub icon="tabler:grid-dots" :label="t('background.grid_size')" :width="150">
			<MenuItem
				v-for="size in GRID_SIZES"
				:key="size"
				:label="t('background.size', { n: size })"
				:checked="grid_size === size"
				@select="ws().change_grid_size(folder_id, size)"
			/>
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
		<MenuSeparator />
		<MenuLabel :label="t('background.folder_bg')" />
		<MenuSub icon="tabler:palette" :label="t('background.color')" :width="196">
			<div class="sw">
				<button
					v-for="preset in PRESET_COLORS"
					:key="preset.label"
					type="button"
					class="c"
					:class="{ on: container?.background === preset.color }"
					:style="{ background: preset.color }"
					:aria-label="preset.label"
					:data-tip="preset.label"
					@click="ws().change_background(folder_id, preset.color)"
				/>
			</div>
		</MenuSub>
		<MenuSub icon="tabler:link" :label="t('background.image')" :width="260">
			<form class="cu" @submit.prevent="apply_custom">
				<input
					v-model="custom"
					v-focus
					class="in"
					:placeholder="t('background.custom_placeholder')"
					spellcheck="false"
					@keydown.stop
				>
				<p class="hn">{{ t('background.custom_hint') }}</p>
			</form>
		</MenuSub>
		<MenuSeparator />
		<MenuItem icon="tabler:arrow-back-up" :label="t('background.reset')" @select="ws().change_background(folder_id, 'none')" />
	</DropMenu>
</template>

<style scoped>
.sw {
	display: grid;
	grid-template-columns: repeat(7, 22px);
	gap: 4px;
	padding: 6px;
}
.c {
	width: 22px;
	height: 22px;
	border-radius: 6px;
	border: 0.5px solid var(--border-strong);
	cursor: pointer;
	padding: 0;
}
.c.on {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
.cu {
	padding: 6px;
	display: flex;
	flex-direction: column;
	gap: 6px;
}
.in {
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
.hn {
	margin: 0;
	font-size: 11px;
	line-height: 1.4;
	color: var(--text-muted);
	white-space: normal;
}
</style>

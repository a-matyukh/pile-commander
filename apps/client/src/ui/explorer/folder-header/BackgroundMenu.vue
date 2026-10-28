<script setup lang="ts">
import { computed, ref } from 'vue'
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
 * canvas), the folder's background color or picture, and a reset
 */
const props = defineProps<{ workspace: WorkspaceStore; folder_id: string; align: 'start' | 'end' }>()

const open = ref(false)
const file_input = ref<HTMLInputElement | null>(null)

const container = computed(() => {
	const folder = props.workspace.folders[props.folder_id]
	return folder ? to_folder_container(folder, props.workspace.preview_folders) : null
})
const canvas = computed(() => container.value?.view === 'canvas')
const grid_size = computed(() => container.value?.grid_size ?? DEFAULT_GRID_SIZE)
const GRID_SIZES = [10, 20, 40, 80]

const ws = () => props.workspace

function pick_image() {
	file_input.value?.click()
}

/** A picture becomes the folder's background as a data URL, as the current app stores it */
function on_image(event: Event) {
	const input = event.target as HTMLInputElement
	const file = input.files?.[0]
	input.value = ''
	if (!file) return
	const reader = new FileReader()
	reader.onload = () => {
		if (typeof reader.result === 'string') void ws().change_background(props.folder_id, reader.result)
	}
	reader.readAsDataURL(file)
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
		<MenuItem icon="tabler:photo" :label="t('background.image')" @select="pick_image" />
		<MenuSeparator />
		<MenuItem icon="tabler:arrow-back-up" :label="t('background.reset')" @select="ws().change_background(folder_id, 'none')" />
	</DropMenu>
	<input ref="file_input" type="file" accept="image/*" class="hidden-input" @change="on_image">
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
.hidden-input {
	display: none;
}
</style>

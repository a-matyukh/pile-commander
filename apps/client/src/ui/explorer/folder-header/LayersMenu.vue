<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { layer_peek_id } from '@/ui/workspace/folder-container/layerPeek'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import { use_pointer_reorder } from '@/ui/kit/use_pointer_reorder'
import LayerGlyph from './LayerGlyph.vue'

/**
 * "Layers" of a board or a canvas, as in the prototype: its items in the
 * order they are drawn, first at the bottom. Dragging one changes that order
 * (the folder's order of children); a click selects it on the board.
 * Hovering a row outlines that item on the board. Once a drag starts, the
 * outline stays on the row being dragged.
 */
const props = defineProps<{ workspace: WorkspaceStore; folder: FolderRef; align: 'start' | 'end' }>()

const open = ref(false)
const list = ref<HTMLElement | null>(null)
const dragging = ref(false)

const children = computed(() => {
	const folder = props.workspace.folders[props.folder.folder_id]
	return folder ? to_folder_container(folder, props.workspace.preview_folders).children : []
})

function move(key: string, target: string, after: boolean) {
	const ids = children.value.map(child => child.id).filter(id => id !== key)
	const index = ids.indexOf(target)
	if (index === -1) return
	ids.splice(after ? index + 1 : index, 0, key)
	void props.workspace.reorder_children(props.folder.folder_id, ids)
}

function row_key(from: Element | null | undefined): string | null {
	const row = from?.closest?.('.ly')
	if (!(row instanceof HTMLElement) || !list.value?.contains(row)) return null
	return row.dataset.key ?? null
}

function peek(event: PointerEvent) {
	if (dragging.value) return
	layer_peek_id.value = row_key(event.target as Element | null)
}

function clear_peek() {
	if (dragging.value) return
	layer_peek_id.value = null
}

function on_dragging(key: string | null, event?: PointerEvent) {
	dragging.value = key !== null
	if (key) {
		layer_peek_id.value = key
		return
	}
	layer_peek_id.value = event ? row_key(document.elementFromPoint(event.clientX, event.clientY)) : null
}

watch(open, (is_open) => {
	if (!is_open) clear_peek()
})
onBeforeUnmount(clear_peek)

use_pointer_reorder({ container: list, item: '.ly', axis: 'y', on_move: move, on_dragging })
</script>

<template>
	<DropMenu v-model:open="open" :width="260" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:stack-2"
				:icon_size="18"
				:aria-label="t('actions.layers')"
				:data-tip="t('actions.layers')"
			/>
		</template>
		<MenuLabel :label="t('layers.title')" />
		<div v-if="children.length" ref="list" @pointerover="peek" @pointerleave="clear_peek">
			<MenuItem
				v-for="child in children"
				:key="child.id"
				class="ly"
				:data-key="child.id"
				:current="workspace.is_selected(child.id)"
				keep_open
				@select="workspace.set_selection([child.id])"
			>
				<template #leading>
					<Icon icon="tabler:grip-vertical" class="gp" />
					<LayerGlyph :workspace="workspace" :folder="folder" :child="child" />
				</template>
				{{ child.name }}
			</MenuItem>
		</div>
		<MenuLabel v-else :label="t('folder.empty')" />
	</DropMenu>
</template>

<style scoped>
.ly.mi {
	cursor: grab;
	touch-action: none;
	padding-left: 4px;
	user-select: none;
	-webkit-user-select: none;
}
.gp {
	font-size: 14px;
	color: var(--text-muted);
}
.ly.dragging {
	opacity: .35;
}
.ly.drop-before {
	box-shadow: inset 0 2px 0 var(--fill-accent);
}
.ly.drop-after {
	box-shadow: inset 0 -2px 0 var(--fill-accent);
}
</style>

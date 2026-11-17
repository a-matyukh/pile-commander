<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { record_action } from '@/store/history'
import { to_folder_container } from '@/services/workspace/folderContainer'
import { board_hover_id, layer_peek_id } from '@/ui/workspace/folder-container/layerPeek'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import { use_pointer_reorder } from '@/ui/kit/use_pointer_reorder'
import LayerGlyph from './LayerGlyph.vue'

/**
 * The items of a board or a canvas in the order they are drawn, first at the
 * bottom. Dragging one changes that order (the folder's order of children); a
 * click selects it on the board. Hovering a row outlines that item on the
 * board. Once a drag starts, the outline stays on the row being dragged.
 * Hovering an item on the board lights its row (and the panel scrolls to it).
 * The layers dropdown and the pinned right panel both show it.
 */
const props = defineProps<{ workspace: WorkspaceStore; folder: FolderRef; as: 'menu' | 'panel' }>()

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
	const ws = props.workspace
	const folder_id = props.folder.folder_id
	void record_action(ws, { folder_id }, t('undo.layers'), tx => ws.reorder_children(folder_id, ids, { tx }))
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

// The panel follows the board: the row of the hovered item comes into view
watch(board_hover_id, async (id) => {
	if (props.as !== 'panel' || !id || dragging.value) return
	await nextTick()
	const row = list.value?.querySelector<HTMLElement>(`.ly[data-key="${CSS.escape(id)}"]`)
	row?.scrollIntoView({ block: 'nearest' })
})

onBeforeUnmount(() => {
	dragging.value = false
	clear_peek()
})

use_pointer_reorder({ container: list, item: '.ly', axis: 'y', on_move: move, on_dragging })
</script>

<template>
	<div v-if="children.length" ref="list" @pointerover="peek" @pointerleave="clear_peek">
		<template v-if="as === 'menu'">
			<MenuItem
				v-for="child in children"
				:key="child.id"
				class="ly"
				:class="{ hov: board_hover_id === child.id }"
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
		</template>
		<template v-else>
			<button
				v-for="child in children"
				:key="child.id"
				type="button"
				class="ly pr"
				:class="{ cur: workspace.is_selected(child.id), hov: board_hover_id === child.id }"
				:data-key="child.id"
				@click="workspace.set_selection([child.id])"
			>
				<Icon icon="tabler:grip-vertical" class="gp" />
				<LayerGlyph :workspace="workspace" :folder="folder" :child="child" />
				<span class="lb">{{ child.name }}</span>
			</button>
		</template>
	</div>
	<MenuLabel v-else-if="as === 'menu'" :label="t('folder.empty')" />
	<p v-else class="em">{{ t('folder.empty') }}</p>
</template>

<style scoped>
.ly {
	position: relative;
	cursor: grab;
	touch-action: none;
	padding-left: 4px;
	user-select: none;
	-webkit-user-select: none;
}
.gp {
	flex: none;
	font-size: 14px;
	color: var(--text-muted);
}
.ly.dragging {
	opacity: .35;
}
/* Where the dragged row lands: a straight line between rows */
.ly.drop-before::after,
.ly.drop-after::after {
	content: '';
	position: absolute;
	left: 4px;
	right: 4px;
	height: 2px;
	border-radius: 1px;
	background: var(--fill-accent);
	pointer-events: none;
}
.ly.drop-before::after {
	top: -1px;
}
.ly.drop-after::after {
	bottom: -1px;
}
/* The item under the mouse on the board */
.ly.hov:not(.cur) {
	background: var(--hv);
}
/* A row of the pinned panel, drawn as a menu item */
.pr {
	display: flex;
	align-items: center;
	gap: 8px;
	width: 100%;
	height: 28px;
	padding-right: 8px;
	border: 0;
	border-radius: 6px;
	background: none;
	color: var(--text-primary);
	font: inherit;
	text-align: left;
	white-space: nowrap;
	outline: none;
}
.pr:hover,
.pr:focus-visible {
	background: var(--hv);
}
.pr.cur {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.pr .lb {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
}
.explorer.lg .pr {
	height: 38px;
}
.em {
	margin: 0;
	padding: 6px 8px;
	font-size: 12px;
	color: var(--text-muted);
}
</style>

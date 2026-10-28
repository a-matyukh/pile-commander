<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import { is_note_name } from '@/services/ai/naming'
import { get_media_kind } from '@/services/board/media'
import { to_folder_container } from '@/services/workspace/folderContainer'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import { use_pointer_reorder } from '@/ui/kit/use_pointer_reorder'

/**
 * "Layers" of a board or a canvas, as in the prototype: its items in the
 * order they are drawn, first at the bottom. Dragging one changes that order
 * (the folder's order of children); a click selects it on the board
 */
const props = defineProps<{ workspace: WorkspaceStore; folder_id: string; align: 'start' | 'end' }>()

const open = ref(false)
const list = ref<HTMLElement | null>(null)

const children = computed(() => {
	const folder = props.workspace.folders[props.folder_id]
	return folder ? to_folder_container(folder, props.workspace.preview_folders).children : []
})

function icon_of(child: FolderContainerWidgetChild): string {
	if (child.type !== 'file') return 'tabler:folder'
	if (is_note_name(child.name)) return 'tabler:note'
	const kind = get_media_kind(child.name)
	if (kind === 'image') return 'tabler:photo'
	if (kind === 'video') return 'tabler:movie'
	if (kind === 'audio') return 'tabler:music'
	return 'tabler:file'
}

function move(key: string, target: string, after: boolean) {
	const ids = children.value.map(child => child.id).filter(id => id !== key)
	const index = ids.indexOf(target)
	if (index === -1) return
	ids.splice(after ? index + 1 : index, 0, key)
	void props.workspace.reorder_children(props.folder_id, ids)
}

use_pointer_reorder({ container: list, item: '.ly', axis: 'y', on_move: move })
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
		<div v-if="children.length" ref="list">
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
					<Icon :icon="icon_of(child)" />
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

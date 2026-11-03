<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import { image_shows_preview } from '@/services/board/layout'
import { get_media_kind } from '@/services/board/media'
import DropMenu from '@/ui/kit/DropMenu.vue'
import FolderMenu from '@/ui/explorer/folder-header/FolderMenu.vue'
import FileMenuItems from './FileMenuItems.vue'
import type { Items } from './use_items'

/** An item's "⋯": a folder shares the tree's menu; a file has its own */
const props = defineProps<{ items: Items; child: FolderContainerWidgetChild; workspace: WorkspaceStore }>()

const preview_label = computed(() => {
	const child = props.child
	if (child.type !== 'file' || get_media_kind(child.name) !== 'image') return undefined
	return image_shows_preview(child)
		? t('board_menu.show_as_file')
		: t('board_menu.preview')
})
</script>

<template>
	<FolderMenu
		v-if="items.is_folder(child)"
		v-model:open="items.menus[child.id]"
		:folder="items.child_ref(child)"
		:name="items.display_name(child)"
		align="end"
		:can_write="workspace.can_write"
		rename_shortcut="F2"
	>
		<template #trigger>
			<span class="idt" :class="{ on: items.menus[child.id] }" :data-tip="t('item.actions')" @click.stop="items.select(child)" @dblclick.stop>
				<Icon icon="tabler:dots" />
			</span>
		</template>
	</FolderMenu>
	<DropMenu v-else v-model:open="items.menus[child.id]" :width="240" align="end">
		<template #trigger>
			<span class="idt" :class="{ on: items.menus[child.id] }" :data-tip="t('item.actions')" @click.stop="items.select(child)" @dblclick.stop>
				<Icon icon="tabler:dots" />
			</span>
		</template>
		<FileMenuItems
			:can_write="workspace.can_write"
			:preview_label="preview_label"
			@open="workspace.open(props.child)"
			@rename="items.start_rename(props.child)"
			@cut="workspace.cut_entries([props.child.id])"
			@copy="workspace.copy_entries([props.child.id])"
			@duplicate="workspace.duplicate_entries([props.child.id])"
			@trash="items.trashing = props.child"
			@toggle_preview="workspace.change_is_preview(props.child.id, !image_shows_preview(props.child))"
		/>
	</DropMenu>
</template>

<style scoped>
.idt {
	justify-self: center;
	display: flex;
	align-items: center;
	justify-content: center;
	width: 26px;
	height: 24px;
	border-radius: 6px;
	color: var(--text-muted);
	cursor: pointer;
	font-size: 16px;
}
.idt.on {
	background: var(--surface-0);
	color: var(--text-primary);
}
.explorer.lg .idt {
	width: 34px;
	height: 32px;
}
@media (hover: hover) {
	.idt:hover {
		background: var(--surface-0);
		color: var(--text-primary);
	}
}
</style>

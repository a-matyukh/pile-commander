<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import DropMenu from '@/ui/kit/DropMenu.vue'
import FolderMenu from '@/ui/explorer/folder-header/FolderMenu.vue'
import FileMenuItems from './FileMenuItems.vue'
import type { Items } from './use_items'

/** An item's "⋯": a folder shares the tree's menu; a file has its own */
const props = defineProps<{ items: Items; child: FolderContainerWidgetChild; workspace: WorkspaceStore }>()
</script>

<template>
	<FolderMenu
		v-if="items.is_folder(child)"
		v-model:open="items.menus[child.id]"
		:folder="items.child_ref(child)"
		:name="items.display_name(child)"
		align="end"
		:can_write="workspace.can_write"
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
			@open="workspace.open(props.child)"
			@rename="items.start_rename(props.child)"
			@cut="workspace.cut_entries([props.child.id])"
			@copy="workspace.copy_entries([props.child.id])"
			@duplicate="workspace.duplicate_entries([props.child.id])"
			@trash="items.trashing = props.child"
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

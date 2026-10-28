<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { ADD_SHAPES, ADD_SHAPE_META, add_menu_has_pane_items, add_note, add_shape, type AddShape } from '@/store/explorer/add_menu'
import { create_child_folder } from '@/store/explorer/folder_menu'
import { entry_view } from '@/store/explorer/tree_view'
import { explorer_tree } from '@/store/explorer/tree'
import { report_error } from '@/store/helpers/reportError'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import MenuSub from '@/ui/kit/MenuSub.vue'
import { useCreateChildItems } from '@/ui/workspace/menu/useCreateChildItems'

/**
 * "Add" in the folder header (prototype AddMenu): the "New" and "Import
 * files…" items of the current folder menu, through the open folder's store.
 * Shown only where the folder can be written
 */
const props = defineProps<{ workspace: WorkspaceStore; folder: FolderRef; align: 'start' | 'end' }>()

const open = ref(false)

/** The current menu's create and import, on the open folder (store.workspace) */
const { create, pick_and_import } = useCreateChildItems(() => props.folder.folder_id)

const item = computed(() => explorer_tree.roots.find(root =>
	root.drive.id === props.folder.drive_id && root.root.id === props.folder.root_id) ?? null)
const pane_items = computed(() =>
	add_menu_has_pane_items(entry_view(props.workspace.resolve_folder_data(props.folder.folder_id) ?? undefined)))

function run(task: () => Promise<unknown>) {
	task().catch(error => report_error(props.workspace, error))
}

function new_shape(shape: AddShape) {
	run(() => add_shape(props.workspace, props.folder.folder_id, shape))
}
</script>

<template>
	<DropMenu v-model:open="open" :width="220" :align="align">
		<template #trigger>
			<IconButton
				class="hb"
				:active="open"
				icon="tabler:plus"
				:icon_size="18"
				:aria-label="t('actions.add')"
				:data-tip="t('actions.add')"
			/>
		</template>
		<MenuItem icon="tabler:folder-plus" :label="t('add.folder')" @select="run(() => create_child_folder(folder, item))" />
		<MenuItem icon="tabler:file-text" :label="t('add.text_file')" @select="run(() => create('file'))" />
		<MenuItem icon="tabler:markdown" :label="t('add.markdown_file')" @select="run(() => create('markdown'))" />
		<template v-if="pane_items">
			<MenuItem icon="tabler:note" :label="t('add.note')" @select="run(() => add_note(workspace, folder.folder_id))" />
			<MenuSub icon="tabler:shape" :label="t('add.shape')">
				<MenuItem
					v-for="shape in ADD_SHAPES"
					:key="shape"
					:icon="ADD_SHAPE_META[shape].icon"
					:label="t(ADD_SHAPE_META[shape].label_key)"
					@select="new_shape(shape)"
				/>
			</MenuSub>
		</template>
		<MenuSeparator />
		<MenuItem icon="tabler:upload" :label="t('add.import_files')" @select="pick_and_import()" />
	</DropMenu>
</template>

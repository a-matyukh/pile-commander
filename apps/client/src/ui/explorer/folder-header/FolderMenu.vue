<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { normalize_workspace_id } from '@/services/workspace/paths'
import { root_folder_id } from '@/store/explorer/folder_header'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import store from '@/store'
import {
	folder_menu_items,
	folder_menu_node,
	reveal_in_finder,
	toggle_bookmark,
} from '@/store/explorer/folder_menu'
import { explorer_tree } from '@/store/explorer/tree'
import { report_error } from '@/store/helpers/reportError'
import Button from '@/ui/kit/Button.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import Modal from '@/ui/kit/Modal.vue'
import RenameFolderDialog from '@/ui/explorer/sidebar/RenameFolderDialog.vue'

/**
 * A folder's "⋯" menu, the same in the folder header and on a tree row, as
 * in the prototype (FolderDotsMenu, FolderMenuBody). The row passes its own
 * trigger in the `trigger` slot
 */
const props = defineProps<{
	folder: FolderRef
	name: string
	align: 'start' | 'end'
	can_write: boolean
	/** The tree row offers "New folder"; the header leaves it to "Add" */
	new_folder?: boolean
}>()

const open = defineModel<boolean>('open', { default: false })
const rename_open = ref(false)
const remove_open = ref(false)

const item = computed(() => explorer_tree.roots.find(root =>
	root.drive.id === props.folder.drive_id && root.root.id === props.folder.root_id) ?? null)
const items = computed(() => folder_menu_items(props.folder, {
	item: item.value,
	can_write: props.can_write,
	desktop: is_desktop,
}))

function rename(new_name: string) {
	if (item.value) void explorer_tree.rename_folder(item.value, folder_menu_node(props.folder), new_name)
}

function remove() {
	remove_open.value = false
	if (item.value) void explorer_tree.remove_folder(item.value, folder_menu_node(props.folder), { open_parent: true })
}

function request_remove() {
	if (item.value?.drive.trash === null) remove_open.value = true
	else remove()
}

function create_folder() {
	if (!item.value) return
	const is_root = normalize_workspace_id(props.folder.folder_id) === root_folder_id(props.folder)
	void explorer_tree.create_folder(item.value, is_root ? null : folder_menu_node(props.folder))
}

function reveal() {
	reveal_in_finder(props.folder).catch(error => report_error(store, error))
}
</script>

<template>
	<DropMenu v-model:open="open" :width="240" :align="align">
		<template #trigger>
			<slot name="trigger">
				<IconButton
					class="hb"
					:active="open"
					icon="tabler:dots"
					:aria-label="t('actions.folder_menu')"
					:data-tip="t('actions.folder_menu')"
				/>
			</slot>
		</template>
		<template v-if="new_folder && can_write && item">
			<MenuItem icon="tabler:folder-plus" :label="t('menu.new_folder')" @select="create_folder" />
			<MenuSeparator />
		</template>
		<MenuItem
			:icon="items.bookmarked ? 'tabler:bookmark-off' : 'tabler:bookmark-plus'"
			:label="items.bookmarked ? t('menu.bookmark_remove') : t('menu.bookmark_add')"
			@select="toggle_bookmark(folder)"
		/>
		<MenuItem v-if="items.show_in_finder" icon="tabler:external-link" :label="t('menu.show_in_finder')" @select="reveal" />
		<template v-if="items.rename || items.move_to_trash">
			<MenuSeparator />
			<MenuItem v-if="items.rename" icon="tabler:pencil" :label="t('menu.rename')" @select="rename_open = true" />
			<MenuItem v-if="items.move_to_trash" icon="tabler:trash" :label="t('menu.move_to_trash')" @select="request_remove" />
		</template>
	</DropMenu>
	<RenameFolderDialog v-model:open="rename_open" :name="name" @confirm="rename" />
	<Modal
		v-if="item?.drive.trash === null"
		v-model:open="remove_open"
		:title="t('tree.delete_permanently_title')"
		:description="t('tree.delete_permanently_description', { name })"
	>
		<template #footer>
			<Button @click="remove_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="remove">
				{{ t('tree.delete_permanently') }}
			</Button>
		</template>
	</Modal>
</template>

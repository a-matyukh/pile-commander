<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import store from '@/store'
import cloud from '@/store/cloud'
import {
	create_child_folder,
	folder_menu_items,
	folder_menu_node,
	remove_confirm_text,
	reveal_in_finder,
	toggle_bookmark,
} from '@/store/explorer/folder_menu'
import { explorer_tree } from '@/store/explorer/tree'
import { trash_sync_note } from '@/store/explorer/share'
import { use_home } from './use_folder_place'
import { explorer_folder_clipboard as clipboard } from '@/store/explorer/folder_clipboard'
import { report_error } from '@/store/helpers/reportError'
import Button from '@/ui/kit/Button.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import Modal from '@/ui/kit/Modal.vue'
import RenameFolderDialog from '@/ui/explorer/sidebar/RenameFolderDialog.vue'
import BackgroundItems from './BackgroundItems.vue'
import FolderLookItems from './FolderLookItems.vue'
import { mod_key_hint } from '@/ui/kit/mod_key'
import TrashSyncNote from './TrashSyncNote.vue'
import { tree_item_for } from '@/store/explorer/tree_item'

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
	/** Set where F2 renames this folder: a row in the list or gallery */
	rename_shortcut?: string
	/** Set with `rename_shortcut`: the keys that cut, copy and duplicate the selected row are named in the menu */
	clipboard_shortcuts?: boolean
	/** Set where Delete / Backspace trashes this folder: a row in the list or gallery */
	remove_shortcut?: string
	/** The open board or canvas, from the folder header: its grid and background follow the look */
	spatial_workspace?: WorkspaceStore | null
}>()

const open = defineModel<boolean>('open', { default: false })
const rename_open = ref(false)
const remove_open = ref(false)
const leave_open = ref(false)

/** Someone else's shared folder leaves this account's list; only its owner can share it again */
async function leave() {
	leave_open.value = false
	await cloud.leave_workspace(props.folder.root_id)
}

const item = computed(() => tree_item_for(props.folder))
const home = use_home()
const items = computed(() => folder_menu_items(props.folder, {
	item: item.value,
	can_write: props.can_write,
	desktop: is_desktop,
	can_paste: item.value ? clipboard.can_paste(item.value, props.folder.folder_id) : false,
	home: home.value,
	owner: props.folder.drive_id === 'cloud' && cloud.role_of(props.folder.root_id) === 'owner',
	member: props.folder.drive_id === 'cloud'
		&& ['editor', 'viewer'].includes(cloud.role_of(props.folder.root_id) ?? ''),
}))
const node = computed(() => ({ ...folder_menu_node(props.folder), name: props.name }))
/** Which groups are there, so a line only ever sits between two of them */
const groups = computed(() => ({
	top: items.value.bookmark || items.value.show_in_finder,
	look: items.value.rename && !!item.value,
	clipboard: items.value.cut || items.value.copy || (items.value.paste && !!clipboard.clip) || items.value.duplicate,
}))

/** Members or a public link: the confirm says what trashing this workspace drops */
const cloud_root_audience = computed(() => {
	const folder = props.folder
	if (folder.drive_id !== 'cloud' || folder.folder_id !== '/') return false
	const id = folder.root_id
	return !!cloud.has_members[id] || !!cloud.hub_listed[id] || !!cloud.published_slugs[id]
})
/** What the trash does to the synced copy: said apart from the rest, so it is not missed */
const sync_note = computed(() => (remove_open.value ? trash_sync_note(props.folder) : null))
const trash_description = computed(() => {
	const base = t(remove_text.value.description, { name: props.name })
	return cloud_root_audience.value ? `${base} ${t('tree.trash_workspace_audience')}` : base
})

function cut() {
	if (item.value) clipboard.cut(item.value, node.value, props.name)
}

function copy() {
	if (item.value) clipboard.copy(item.value, node.value, props.name)
}

function paste() {
	if (item.value) void clipboard.paste(item.value, props.folder.folder_id)
}

function duplicate() {
	if (item.value) void explorer_tree.duplicate_folder(item.value, node.value)
}

function rename(new_name: string) {
	if (item.value) void explorer_tree.rename_folder(item.value, folder_menu_node(props.folder), new_name)
}

function remove() {
	remove_open.value = false
	if (item.value) void explorer_tree.remove_folder(item.value, folder_menu_node(props.folder), { open_parent: true })
}

function ungroup() {
	if (item.value) void explorer_tree.ungroup_folder(item.value, folder_menu_node(props.folder))
}

const remove_text = computed(() => remove_confirm_text(item.value?.drive))

function create_folder() {
	void create_child_folder(props.folder, item.value)
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
			v-if="items.bookmark"
			:icon="items.bookmarked ? 'tabler:bookmark-off' : 'tabler:bookmark-plus'"
			:label="items.bookmarked ? t('menu.bookmark_remove') : t('menu.bookmark_add')"
			@select="toggle_bookmark(folder)"
		/>
		<MenuItem v-if="items.show_in_finder" icon="tabler:external-link" :label="t('menu.show_in_finder')" @select="reveal" />
		<!-- Its icon and its cover, kept apart as in Finder and Milanote -->
		<template v-if="groups.look">
			<MenuSeparator v-if="groups.top" />
			<FolderLookItems v-if="item" :item="item" :folder="folder" />
		</template>
		<template v-if="spatial_workspace">
			<MenuSeparator v-if="groups.top || groups.look" />
			<BackgroundItems :workspace="spatial_workspace" :folder_id="folder.folder_id" />
		</template>
		<template v-if="groups.clipboard">
			<MenuSeparator v-if="groups.top || groups.look || spatial_workspace" />
			<MenuItem v-if="items.cut" icon="tabler:cut" :label="t('menu.cut')" :shortcut="clipboard_shortcuts ? mod_key_hint('X') : undefined" @select="cut" />
			<MenuItem v-if="items.copy" icon="tabler:copy" :label="t('menu.copy')" :shortcut="clipboard_shortcuts ? mod_key_hint('C') : undefined" @select="copy" />
			<MenuItem
				v-if="items.paste && clipboard.clip"
				icon="tabler:clipboard"
				:label="t('menu.paste_folder', { name: clipboard.clip.name })"
				@select="paste"
			/>
			<MenuItem v-if="items.duplicate" icon="tabler:copy-plus" :label="t('menu.duplicate')" :shortcut="clipboard_shortcuts ? mod_key_hint('D') : undefined" @select="duplicate" />
		</template>
		<template v-if="items.rename || items.move_to_trash">
			<MenuSeparator v-if="groups.top || groups.look || spatial_workspace || groups.clipboard" />
			<MenuItem v-if="items.rename" icon="tabler:pencil" :label="t('menu.rename')" :shortcut="rename_shortcut" @select="rename_open = true" />
			<MenuItem
				v-if="items.ungroup"
				icon="tabler:stack-pop"
				:label="t('menu.ungroup_folder')"
				:data-tip="t('menu.ungroup_folder_tip')"
				@select="ungroup"
			/>
			<MenuItem v-if="items.move_to_trash" icon="tabler:trash" :label="t(remove_text.confirm)" :shortcut="remove_shortcut" @select="remove_open = true" />
		</template>
		<template v-if="items.leave">
			<MenuSeparator v-if="groups.top || groups.look || spatial_workspace || groups.clipboard" />
			<MenuItem icon="tabler:logout" :label="t('menu.leave_folder')" @select="leave_open = true" />
		</template>
	</DropMenu>
	<RenameFolderDialog v-model:open="rename_open" :name="name" @confirm="rename" />
	<Modal
		v-model:open="leave_open"
		:title="t('menu.leave_folder_title', { name })"
		:description="t('menu.leave_folder_description')"
	>
		<template #footer>
			<Button @click="leave_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="leave">{{ t('menu.leave_folder') }}</Button>
		</template>
	</Modal>
	<Modal
		v-if="item"
		v-model:open="remove_open"
		:title="t(remove_text.title, { name })"
		:description="trash_description"
	>
		<TrashSyncNote v-if="sync_note" :note="sync_note" />
		<template #footer>
			<Button @click="remove_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="remove">
				{{ t(remove_text.confirm) }}
			</Button>
		</template>
	</Modal>
</template>


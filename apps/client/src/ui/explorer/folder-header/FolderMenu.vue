<script setup lang="ts">
import { computed, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import store from '@/store'
import {
	create_child_folder,
	folder_menu_items,
	folder_menu_node,
	remove_confirm_text,
	reveal_in_finder,
	toggle_bookmark,
} from '@/store/explorer/folder_menu'
import { explorer_tree, tree_root_folder_id } from '@/store/explorer/tree'
import { FOLDER_ICON_COLORS, FOLDER_ICONS, read_folder_icon, write_folder_icon, type FolderIcon } from '@/store/explorer/folder_cover'
import { parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { Icon } from '@iconify/vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
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
const home = use_home()
const items = computed(() => folder_menu_items(props.folder, {
	item: item.value,
	can_write: props.can_write,
	desktop: is_desktop,
	can_paste: item.value ? clipboard.can_paste(item.value, props.folder.folder_id) : false,
	home: home.value,
}))
const node = computed(() => ({ ...folder_menu_node(props.folder), name: props.name }))

/** The folder's own icon and its color, as the prototype's: kept in its cover */
const folder_icon = computed(() => {
	const store = item.value?.workspace
	if (!store) return null
	const own = store.folders[props.folder.folder_id]?.xattrs
	const parent = store.folders[parent_folder_id_from_node_id(props.folder.folder_id, tree_root_folder_id(item.value!))]
	const listed = parent?.children.find(child => child.id === props.folder.folder_id)?.xattrs
	return read_folder_icon((own ?? listed)?.find(xattr => xattr.name === 'cover')?.value)
})

function set_icon(next: Partial<FolderIcon>) {
	if (!item.value) return
	const icon = { icon: folder_icon.value?.icon ?? 'tabler:folder', color: folder_icon.value?.color ?? '', ...next }
	void explorer_tree.set_folder_cover(item.value, props.folder.folder_id, write_folder_icon(icon))
}

function reset_icon() {
	if (item.value) void explorer_tree.set_folder_cover(item.value, props.folder.folder_id, 'none')
}

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

const remove_text = computed(() => remove_confirm_text(item.value?.drive.trash ?? null))

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
			:icon="items.bookmarked ? 'tabler:bookmark-off' : 'tabler:bookmark-plus'"
			:label="items.bookmarked ? t('menu.bookmark_remove') : t('menu.bookmark_add')"
			@select="toggle_bookmark(folder)"
		/>
		<MenuItem v-if="items.show_in_finder" icon="tabler:external-link" :label="t('menu.show_in_finder')" @select="reveal" />
		<!-- The folder's own icon, as in the prototype -->
		<template v-if="items.rename">
			<MenuSeparator />
			<MenuLabel :label="t('style.icon_color')" />
			<div class="swr">
				<button
					v-for="color in FOLDER_ICON_COLORS"
					:key="color || 'none'"
					type="button"
					class="swc"
					:class="{ on: (folder_icon?.color ?? '') === color }"
					:style="{ background: color || 'var(--surface-0)' }"
					:aria-label="color || t('style.no_color')"
					:data-tip="color ? undefined : t('style.no_color')"
					@click="set_icon({ color })"
				/>
			</div>
			<MenuLabel :label="t('style.icon')" />
			<div class="swr">
				<button
					v-for="icon in FOLDER_ICONS"
					:key="icon"
					type="button"
					class="swi"
					:class="{ on: folder_icon?.icon === icon }"
					:aria-label="icon"
					@click="set_icon({ icon })"
				>
					<Icon :icon="icon" :style="{ color: folder_icon?.color || undefined }" />
				</button>
			</div>
			<MenuItem icon="tabler:arrow-back-up" :label="t('style.default_icon')" @select="reset_icon" />
		</template>
		<template v-if="items.cut || items.copy || items.paste || items.duplicate">
			<MenuSeparator />
			<MenuItem v-if="items.cut" icon="tabler:cut" :label="t('menu.cut')" @select="cut" />
			<MenuItem v-if="items.copy" icon="tabler:copy" :label="t('menu.copy')" @select="copy" />
			<MenuItem
				v-if="items.paste && clipboard.clip"
				icon="tabler:clipboard"
				:label="t('menu.paste_folder', { name: clipboard.clip.name })"
				@select="paste"
			/>
			<MenuItem v-if="items.duplicate" icon="tabler:copy-plus" :label="t('menu.duplicate')" @select="duplicate" />
		</template>
		<template v-if="items.rename || items.move_to_trash">
			<MenuSeparator />
			<MenuItem v-if="items.rename" icon="tabler:pencil" :label="t('menu.rename')" @select="rename_open = true" />
			<MenuItem
				v-if="items.ungroup"
				icon="tabler:stack-pop"
				:label="t('menu.ungroup_folder')"
				:data-tip="t('menu.ungroup_folder_tip')"
				@select="ungroup"
			/>
			<MenuItem v-if="items.move_to_trash" icon="tabler:trash" :label="t('menu.move_to_trash')" @select="remove_open = true" />
		</template>
	</DropMenu>
	<RenameFolderDialog v-model:open="rename_open" :name="name" @confirm="rename" />
	<Modal
		v-if="item"
		v-model:open="remove_open"
		:title="t(remove_text.title, { name })"
		:description="t(remove_text.description, { name })"
	>
		<template #footer>
			<Button @click="remove_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="remove">
				{{ t(remove_text.confirm) }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.swr {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
	padding: 2px 8px 6px;
}
.swc {
	width: 18px;
	height: 18px;
	border: 0;
	padding: 0;
	border-radius: 50%;
	cursor: pointer;
	box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, .2);
}
.swc.on {
	box-shadow: 0 0 0 2px var(--surface-3), 0 0 0 3.5px var(--fill-accent);
}
.swi {
	width: 26px;
	height: 26px;
	border: 0;
	padding: 0;
	border-radius: 6px;
	background: none;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	color: var(--text-secondary);
	font-size: 16px;
}
.swi.on {
	background: var(--bg-accent);
	color: var(--text-accent);
}
@media (hover: hover) {
	.swi:hover {
		background: var(--surface-1);
	}
}
</style>

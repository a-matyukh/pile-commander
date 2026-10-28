<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { explorer_drives } from '@/store/explorer/drives'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'
import { read_folder_icon, standard_folder_icon, system_folder_name } from '@/store/explorer/folder_cover'
import { remove_confirm_text } from '@/store/explorer/folder_menu'
import { entry_view } from '@/store/explorer/tree_view'
import { format_bytes } from '@/utils/format_bytes'
import Button from '@/ui/kit/Button.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import Modal from '@/ui/kit/Modal.vue'
import FolderMenu from '@/ui/explorer/folder-header/FolderMenu.vue'
import { use_home } from '@/ui/explorer/folder-header/use_folder_place'
import RenameFolderDialog from '@/ui/explorer/sidebar/RenameFolderDialog.vue'
import FileMenuItems from './FileMenuItems.vue'
import { file_icon } from './entry_icon'

/**
 * "List", as in the prototype: one row per item with its icon, name, size
 * and "⋯". A click selects, a double click opens, a right click opens the
 * item's menu. Folders share the tree's menu. "Modified" waits for a file
 * manager that reports it (BACKLOG.md)
 */
const props = defineProps<{ workspace: WorkspaceStore; container: FolderContainerWidget; location: FolderRef }>()

const home = use_home()
const children = computed(() => props.container.children)
const is_folder = (child: FolderContainerWidgetChild) => child.type !== 'file'
const child_ref = (child: FolderContainerWidgetChild): FolderRef => ({ ...props.location, folder_id: child.id })

/** An item's attributes as the open folder's read lists them (the view, the cover) */
function listed(child: FolderContainerWidgetChild) {
	return props.workspace.folders[props.location.folder_id]?.children.find(entry => entry.id === child.id)
}

/** A folder's icon as the tree draws it: its own, its view, a macOS folder, a folder */
function glyph(child: FolderContainerWidgetChild): { icon: string; color?: string; plain: boolean } {
	if (!is_folder(child)) return { icon: file_icon(child.name), plain: true }
	const entry = listed(child)
	const own = read_folder_icon(entry?.xattrs.find(xattr => xattr.name === 'cover')?.value)
	if (own) return { icon: own.icon, color: own.color || undefined, plain: !own.color }
	const view = entry_view(entry)
	if (view !== 'list') return { icon: FOLDER_VIEW_META[view].icon, color: FOLDER_VIEW_META[view].color ?? undefined, plain: false }
	return { icon: standard_folder_icon(child_ref(child), home.value) ?? 'tabler:folder', plain: true }
}

function display_name(child: FolderContainerWidgetChild): string {
	return is_folder(child) ? system_folder_name(child_ref(child), home.value) ?? child.name : child.name
}

/** File sizes, read a few at a time; folders show a dash */
const sizes = reactive(new Map<string, string>())
let reading = 0
const waiting: string[] = []
function read_sizes() {
	while (reading < 4 && waiting.length) {
		const id = waiting.shift()!
		reading += 1
		props.workspace.file_manager.entry_size(id)
			.then(bytes => { sizes.set(id, format_bytes(bytes)) })
			.catch(() => { sizes.set(id, '—') })
			.finally(() => { reading -= 1; read_sizes() })
	}
}
watch(children, (list) => {
	for (const child of list) {
		if (is_folder(child) || sizes.has(child.id) || waiting.includes(child.id)) continue
		waiting.push(child.id)
	}
	read_sizes()
}, { immediate: true })

const menus = reactive<Record<string, boolean>>({})

function select(child: FolderContainerWidgetChild) {
	props.workspace.set_selection([child.id])
}

function open_menu(child: FolderContainerWidgetChild) {
	select(child)
	menus[child.id] = true
}

/** The dialog closes itself before it hands the name over: the item stays until then */
const renaming = ref<FolderContainerWidgetChild | null>(null)
const rename_open = ref(false)
function start_rename(child: FolderContainerWidgetChild) {
	renaming.value = child
	rename_open.value = true
}
function rename(name: string) {
	const child = renaming.value
	if (child && name !== child.name) void props.workspace.rename(child.id, name)
}

const trashing = ref<FolderContainerWidgetChild | null>(null)
const trash_open = computed({
	get: () => trashing.value !== null,
	set: (open: boolean) => { if (!open) trashing.value = null },
})
const to_trash = computed(() => remove_confirm_text(explorer_drives.drive(props.location.drive_id)?.trash ?? null).confirm !== 'tree.delete_permanently')
function trash() {
	const child = trashing.value
	trashing.value = null
	if (child) void props.workspace.remove(child.id)
}
</script>

<template>
	<div class="lv">
		<div class="li head">
			<span class="hn">{{ t('list.name') }}</span>
			<span class="rt">{{ t('list.size') }}</span>
			<span class="ct">{{ t('list.actions') }}</span>
		</div>
		<div
			v-for="child in children"
			:key="child.id"
			class="li"
			:class="{ s: workspace.is_selected(child.id), hid: is_hidden_entry_name(child.name), cut: workspace.is_cut(child.id) }"
			:data-item-id="child.id"
			@click="select(child)"
			@dblclick="workspace.open(child)"
			@contextmenu.prevent="open_menu(child)"
		>
			<span class="n">
				<Icon :icon="glyph(child).icon" :class="{ plain: glyph(child).plain }" :style="{ color: glyph(child).color }" />
				<span class="nm">{{ display_name(child) }}</span>
			</span>
			<span class="m rt">{{ is_folder(child) ? '—' : sizes.get(child.id) ?? '' }}</span>
			<FolderMenu
				v-if="is_folder(child)"
				v-model:open="menus[child.id]"
				:folder="child_ref(child)"
				:name="display_name(child)"
				align="end"
				:can_write="workspace.can_write"
			>
				<template #trigger>
					<span class="idt" :class="{ on: menus[child.id] }" :data-tip="t('item.actions')" @click.stop="select(child)">
						<Icon icon="tabler:dots" />
					</span>
				</template>
			</FolderMenu>
			<DropMenu v-else v-model:open="menus[child.id]" :width="240" align="end">
				<template #trigger>
					<span class="idt" :class="{ on: menus[child.id] }" :data-tip="t('item.actions')" @click.stop="select(child)">
						<Icon icon="tabler:dots" />
					</span>
				</template>
				<FileMenuItems
					:can_write="workspace.can_write"
					@open="workspace.open(child)"
					@rename="start_rename(child)"
					@cut="workspace.cut_entries([child.id])"
					@copy="workspace.copy_entries([child.id])"
					@duplicate="workspace.duplicate_entries([child.id])"
					@trash="trashing = child"
				/>
			</DropMenu>
		</div>
		<p v-if="!children.length" class="none">{{ t('list.empty') }}</p>

		<RenameFolderDialog v-model:open="rename_open" :name="renaming?.name ?? ''" @confirm="rename" />
		<Modal
			v-model:open="trash_open"
			:title="t(to_trash ? 'list.file_trash_title' : 'list.file_delete_title', { name: trashing?.name ?? '' })"
			:description="t(to_trash ? 'list.file_trash_description' : 'list.file_delete_description')"
		>
			<template #footer>
				<Button @click="trash_open = false">{{ t('dialog.cancel') }}</Button>
				<Button variant="danger" @click="trash">{{ t(to_trash ? 'menu.move_to_trash' : 'tree.delete_permanently') }}</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.lv {
	user-select: none;
	-webkit-user-select: none;
}
.li {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 90px 90px;
	align-items: center;
	height: 32px;
	padding: 0 16px;
	border-bottom: 0.5px solid var(--border);
	color: var(--text-primary);
	cursor: default;
}
.li.head {
	height: 30px;
	font-size: 11px;
	color: var(--text-muted);
}
.n {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
}
.n :deep(svg) {
	font-size: 16px;
	flex: none;
}
.nm {
	overflow: hidden;
	text-overflow: ellipsis;
}
.plain {
	color: var(--text-secondary);
}
.m {
	font-size: 12px;
	color: var(--text-muted);
}
.rt {
	text-align: right;
}
.ct {
	text-align: center;
}
.hn {
	padding-left: 2px;
}
.li.hid .n,
.li.cut .n {
	opacity: .5;
}
.li.s {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.li.s .plain {
	color: var(--text-accent);
}
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
.none {
	margin: 0;
	padding: 16px;
	font-size: 12px;
	color: var(--text-muted);
}
.explorer.lg .li {
	height: 42px;
	grid-template-columns: minmax(0, 1fr) 104px 104px;
}
.explorer.lg .li.head {
	height: 30px;
}
.explorer.lg .hn {
	padding-left: 2.5px;
}
.explorer.lg .n :deep(svg) {
	font-size: 19px;
}
.explorer.lg .m {
	font-size: 13px;
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

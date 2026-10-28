<script setup lang="ts">
import { computed, ref, watch, watchEffect } from 'vue'
import { Icon } from '@iconify/vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { t } from '@/i18n'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { explorer_navigation } from '@/store/explorer/navigation'
import {
	explorer_tree,
	is_legacy_browser_folder,
	tree_root_folder_id,
	type ExplorerTreeRoot,
} from '@/store/explorer/tree'
import { arranged_children } from '@/store/explorer/tree_arrange'
import { entry_view } from '@/store/explorer/tree_view'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'
import { show_hidden_files } from '@/store/showHiddenFiles'
import cloud from '@/store/cloud'
import { is_bookmarked } from '@/store/explorer/bookmarks'
import { shows_synced } from '@/store/explorer/share'
import { read_folder_icon, standard_folder_icon, system_folder } from '@/store/explorer/folder_cover'
import { use_home } from '@/ui/explorer/folder-header/use_folder_place'
import { is_transient_drive } from '@/store/explorer/public_roots'
import { explorer_folder_clipboard } from '@/store/explorer/folder_clipboard'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import FolderMenu from '@/ui/explorer/folder-header/FolderMenu.vue'
import { CLOUD_ROOT_DROP_KEY, is_drop_target, press_tree_row, register_drop_opener, tree_drag, tree_root_key } from './tree_drag'

const props = defineProps<{
	item: ExplorerTreeRoot
	node?: WorkspaceTreeNode
}>()

const menu_open = ref(false)
const folder_id = computed(() => props.node?.id ?? tree_root_folder_id(props.item))
const workspace = computed(() => props.item.workspace)
const children = computed(() => arranged_children(
	props.item,
	folder_id.value,
	(props.node ? props.node.children : workspace.value?.tree) ?? [],
))
const expanded = computed(() => props.node
	? workspace.value?.is_folder_expanded(folder_id.value) === true
	: explorer_tree.is_root_expanded(props.item))
// A look-ahead read is not the user's expand: no spinner for it
const moving = computed(() => explorer_tree.is_moving(props.item, folder_id.value))
const cut = computed(() => explorer_folder_clipboard.is_cut(props.item, folder_id.value))
const loading = computed(() => moving.value || (props.node
	? workspace.value?.is_folder_loading(folder_id.value) === true
		&& !explorer_tree.is_probing(props.item, folder_id.value)
	: props.item.loading))
const can_expand = computed(() => {
	if (loading.value) return true
	// A read folder shows what the filter leaves; an unread one, what the look-ahead found
	if (props.node?.children_loaded) return children.value.length > 0
	if (props.node) return explorer_tree.has_chevron(props.item, props.node, show_hidden_files.value)
	if (workspace.value && !workspace.value.is_disposed) return children.value.length > 0
	// A root not opened yet: subfolders came with the root list (cloud)
	const known = props.item.root.subfolders
	if (!known) return true
	return known.some(name => show_hidden_files.value || !is_hidden_entry_name(name))
})
const current = computed(() => {
	const location = explorer_navigation.location
	return location?.kind === 'folder'
		&& location.ref.drive_id === props.item.drive.id
		&& location.ref.root_id === props.item.root.id
		&& location.ref.folder_id === folder_id.value
})
const home = use_home()
/** macOS's own folders in ~ show Finder's name ("Загрузки"); the folder on disk keeps its own */
const system = computed(() => props.node ? system_folder({ drive_id: props.item.drive.id, root_id: props.item.root.id, folder_id: props.node.id }, home.value) : null)
const name = computed(() => props.node
	? (system.value ? t(`system_folders.${system.value}`) : explorer_tree.node_name(props.item, props.node))
	: props.item.root.name)
const hidden = computed(() => props.node ? is_hidden_entry_name(props.node.name) : false)
const can_write = computed(() => workspace.value?.can_write ?? props.item.root.can_write)

watch(
	() => expanded.value ? [children.value, explorer_tree.round] as const : null,
	shown => { if (shown) explorer_tree.probe_folders(props.item, shown[0]) },
	{ immediate: true },
)

function toggle() {
	if (props.node) void explorer_tree.toggle_folder(props.item, props.node)
	else void explorer_tree.toggle_root(props.item)
}


/**
 * A folder with its own view shows that view's icon in color, as in the
 * prototype; a plain list folder keeps the folder icon. The view lives in
 * the attributes the parent's read brought (a root: its own read)
 */
/** This row's folder as its parent's read lists it (a root: its own read) */
const entry = computed(() => {
	const store = workspace.value
	if (!store || store.is_disposed) return undefined
	return props.node
		? store.folders[parent_folder_id_from_node_id(props.node.id, tree_root_folder_id(props.item))]
			?.children.find(child => child.id === props.node!.id)
		: store.folders[tree_root_folder_id(props.item)]
})

const view_meta = computed(() => {
	const store = workspace.value
	if (!store || store.is_disposed) {
		// A cloud root not opened yet: its view came with the root list
		const known = props.node ? undefined : props.item.root.view
		const view = known ? entry_view({ xattrs: [{ name: 'view', value: known }] }) : 'list'
		return view === 'list' ? null : FOLDER_VIEW_META[view]
	}
	const view = entry_view(entry.value)
	return view === 'list' ? null : FOLDER_VIEW_META[view]
})

/**
 * The row's icon: the folder's own one (chosen in its menu), then its view
 * in color, then macOS's own folders in ~ (Downloads, Music…), then a folder
 */
const glyph = computed(() => {
	// Written on the folder itself: its own read first, then the parent's listing
	const store = workspace.value
	const own_read = store && !store.is_disposed ? store.folders[folder_id.value]?.xattrs : undefined
	const cover = (own_read ?? entry.value?.xattrs)?.find(xattr => xattr.name === 'cover')?.value
	const own = read_folder_icon(cover)
	if (own) return { icon: own.icon, color: own.color || undefined, plain: !own.color }
	if (view_meta.value) return { icon: view_meta.value.icon, color: view_meta.value.color ?? undefined, plain: false }
	const standard = standard_folder_icon(row_ref.value, home.value)
	if (standard) return { icon: standard, color: undefined, plain: true }
	return { icon: expanded.value && children.value.length ? 'tabler:folder-open' : 'tabler:folder', color: undefined, plain: true }
})

/** This row's folder as an address, for the shared folder menu */
const row_ref = computed(() => ({ drive_id: props.item.drive.id, root_id: props.item.root.id, folder_id: folder_id.value }))

const root_key = computed(() => tree_root_key(props.item.drive.id, props.item.root.id))
const spot = computed(() => ({ root_key: root_key.value, folder_id: folder_id.value }))
const drop_target = computed(() => is_drop_target(spot.value))
const dragged = computed(() => tree_drag.source?.root_key === root_key.value
	&& tree_drag.source.folder_id === folder_id.value)

const root_move_open = ref(false)
const pending_root_move = ref<{ target: ExplorerTreeRoot; folder_id: string } | null>(null)
const root_move_needs_warning = computed(() => props.item.drive.kind === 'cloud' && Boolean(
	cloud.shared_out[props.item.root.id]
	|| cloud.published_slugs[props.item.root.id]
	|| cloud.hub_listed[props.item.root.id],
))
watch(root_move_open, open => { if (!open) pending_root_move.value = null })

function request_root_move(target: ExplorerTreeRoot, target_folder_id: string) {
	if (root_move_needs_warning.value) {
		pending_root_move.value = { target, folder_id: target_folder_id }
		root_move_open.value = true
		return
	}
	void explorer_tree.transfer_cloud_root(props.item, target, target_folder_id)
}

function confirm_root_move() {
	const pending = pending_root_move.value
	root_move_open.value = false
	pending_root_move.value = null
	if (pending) void explorer_tree.transfer_cloud_root(props.item, pending.target, pending.folder_id)
}

/**
 * Nested folders and cloud roots are drag sources. A legacy browser folder
 * stays put: the old interface finds it by its path until step 4.2. The
 * chevron and the menu keep their own clicks
 */
function press(event: PointerEvent) {
	const node = props.node
	// macOS's own folders stay where they are, as in Finder
	if (!can_write.value || system.value || (node
		? is_legacy_browser_folder(props.item, node)
		: props.item.drive.kind !== 'cloud')) return
	if (event.target instanceof Element && event.target.closest('.tg, .cv')) return
	// A press on a row starts a drag, not a text selection
	event.preventDefault()
	press_tree_row(event, {
		...spot.value,
		name: name.value,
		parent_id: node
			? parent_folder_id_from_node_id(node.id, tree_root_folder_id(props.item))
			: folder_id.value,
	}, target => {
		if (target.root_key === CLOUD_ROOT_DROP_KEY) {
			if (node) void explorer_tree.transfer_folder_to_cloud_root(props.item, node)
			return
		}
		if (target.root_key === root_key.value) {
			if (node) void explorer_tree.move_folder(props.item, node, target.folder_id)
			return
		}
		const target_item = explorer_tree.roots.find(item =>
			tree_root_key(item.drive.id, item.root.id) === target.root_key)
		if (!target_item) return
		if (node) void explorer_tree.transfer_folder(props.item, node, target_item, target.folder_id)
		else request_root_move(target_item, target.folder_id)
	})
}

// Hovering a collapsed folder during a drag opens it, to drop deeper
watchEffect(on_cleanup => {
	on_cleanup(register_drop_opener(spot.value, () => {
		if (!expanded.value && can_expand.value) toggle()
	}))
})
</script>

<template>
	<div
		class="r"
		:class="{ sel: current, mo: menu_open, hid: hidden, drop: drop_target, drg: dragged || moving || cut }"
		:data-folder-id="folder_id"
		:data-drive-id="item.drive.id"
		:data-root-id="item.root.id"
		:data-drop-root="can_write ? root_key : undefined"
		:data-drop-folder="can_write ? folder_id : undefined"
		@pointerdown="press"
		@click="explorer_tree.open_folder(item, folder_id)"
	>
		<Icon
			v-if="loading"
			icon="tabler:loader-2"
			class="cv spin"
		/>
		<Icon
			v-else-if="can_expand"
			:icon="expanded ? 'tabler:chevron-down' : 'tabler:chevron-right'"
			class="cv"
			@click.stop="toggle"
		/>
		<span v-else class="sp" />
		<Icon :icon="glyph.icon" :class="glyph.plain ? 'plain' : 'vw'" :style="{ color: glyph.color }" />
		<span class="nm">{{ name }}</span>
		<span class="tg">
			<span v-if="shows_synced(row_ref)" class="bdg" :data-tip="t('badge.synced')"><Icon icon="tabler:cloud-check" /></span>
			<span v-if="is_bookmarked(row_ref)" class="bdg" :data-tip="t('badge.bookmarked')"><Icon icon="tabler:bookmark" /></span>
			<!-- A publication or the demo is not one of the user's places: no folder menu -->
			<FolderMenu
				v-if="!is_transient_drive(item.drive.id)"
				v-model:open="menu_open"
				:folder="row_ref"
				:name="name"
				align="start"
				:can_write="can_write"
				new_folder
			>
				<template #trigger>
					<span class="dt" :data-tip="t('tree.folder_menu')" @click.stop><Icon icon="tabler:dots" /></span>
				</template>
			</FolderMenu>
		</span>
	</div>
	<div v-if="expanded && (children.length || loading)" class="g">
		<TreeRow v-for="child in children" :key="child.id" :item="item" :node="child" />
	</div>
	<Modal
		v-if="!node && item.drive.kind === 'cloud'"
		v-model:open="root_move_open"
		:title="t('tree.move_root_warning_title')"
		:description="t('tree.move_root_warning_description', { name })"
	>
		<template #footer>
			<Button @click="root_move_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="confirm_root_move">
				{{ t('tree.move_root_warning_confirm') }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.r {
	user-select: none;
	-webkit-user-select: none;
	display: flex;
	align-items: center;
	gap: 6px;
	height: 28px;
	padding: 0 4px 0 6px;
	color: var(--text-primary);
	border-radius: 6px;
	margin: 0 6px;
	white-space: nowrap;
	cursor: pointer;
}
.r.mo {
	background: var(--hv);
}
.r.drop {
	background: var(--bg-accent);
	box-shadow: inset 0 0 0 1px var(--border-accent);
}
.r.drg {
	opacity: .45;
}
.r.hid {
	opacity: .5;
}
.r > :deep(svg) {
	font-size: 16px;
}
.plain {
	color: var(--text-secondary);
}
.nm {
	overflow: hidden;
	text-overflow: ellipsis;
}
.cv {
	color: var(--text-muted);
	width: 14px;
	font-size: 14px !important;
}
.sp {
	width: 14px;
	flex: none;
}
.tg {
	margin-left: auto;
	display: flex;
	gap: 4px;
	align-items: center;
}
.bdg {
	display: flex;
	color: var(--text-muted);
	font-size: 13px;
}
.r.sel .bdg {
	color: var(--text-accent);
}
.dt {
	display: none;
	align-items: center;
	justify-content: center;
	width: 20px;
	height: 20px;
	border-radius: 4px;
	color: var(--text-secondary);
	font-size: 14px;
}
.r.mo .dt,
.r.sel .dt {
	display: flex;
}
.r.sel {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.r.sel .cv,
.r.sel .dt,
.r.sel :deep(.plain) {
	color: var(--text-accent);
}
.g {
	border-left: 0.5px solid var(--border);
	margin-left: 13px;
}
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
.explorer.lg .r {
	height: 38px;
}
.explorer.lg .r > :deep(svg) {
	font-size: 19px;
}
.explorer.lg .cv,
.explorer.lg .sp {
	width: 18px;
}
.explorer.lg .cv {
	font-size: 17px !important;
}
.explorer.lg .dt {
	width: 26px;
	height: 26px;
}
.explorer.lg .g {
	margin-left: 15px;
}
@media (hover: hover) {
	.r:hover {
		background: var(--hv);
	}
	.r.sel:hover {
		background: var(--bg-accent);
	}
	.r:hover .dt {
		display: flex;
	}
	.cv:hover {
		color: var(--text-primary);
	}
	.dt:hover {
		background: var(--surface-2);
	}
}
</style>

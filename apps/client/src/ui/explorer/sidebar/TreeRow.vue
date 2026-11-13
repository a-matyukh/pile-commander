<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { Icon } from '@iconify/vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { t } from '@/i18n'
import { entry_is_dimmed } from '@/store/hiddenPaths'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { normalize_workspace_id, parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { covering_link, my_sync_roots } from '@/store/localSync'
import { is_within } from '@/store/explorer/drives'
import { explorer_navigation } from '@/store/explorer/navigation'
import {
	explorer_tree,
	tree_root_folder_id,
	type ExplorerTreeRoot,
} from '@/store/explorer/tree'
import { arranged_children } from '@/store/explorer/tree_arrange'
import { entry_view } from '@/store/explorer/tree_view'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'
import { show_hidden_files } from '@/store/showHiddenFiles'
import cloud from '@/store/cloud'
import { is_bookmarked } from '@/store/explorer/bookmarks'
import { pile_line_state, shows_synced, sync_badge, sync_status_of, synced_tip } from '@/store/explorer/share'
import { folder_icon_of, standard_folder_icon, system_folder } from '@/store/explorer/folder_cover'
import { shown_icon } from '@/store/explorer/icon_catalog'
import { use_home } from '@/ui/explorer/folder-header/use_folder_place'
import { is_transient_drive } from '@/store/explorer/public_roots'
import { explorer_folder_clipboard } from '@/store/explorer/folder_clipboard'
import { explorer_settings } from '@/store/explorer/settings'
import Button from '@/ui/kit/Button.vue'
import Modal from '@/ui/kit/Modal.vue'
import FolderMenu from '@/ui/explorer/folder-header/FolderMenu.vue'
import { CLOUD_ROOT_DROP_KEY, is_drop_target, pile_crossing, press_tree_row, register_drop_opener, row_can_drag, tree_drag, tree_root_key } from './tree_drag'

const props = defineProps<{
	item: ExplorerTreeRoot
	node?: WorkspaceTreeNode
}>()

const menu_open = ref(false)
/**
 * The dots are `display: none` until the row is hovered, current, or holding
 * this menu. Closing clears `menu_open` at once, and with smooth menus the
 * panel still fades for 0.1s. If the dots vanish then, their anchor's box is
 * empty and the fading menu jumps to the corner. Hold the anchor until that
 * fade is over.
 */
const menu_anchor = ref(false)
let menu_anchor_timer = 0
watch(menu_open, (open) => {
	window.clearTimeout(menu_anchor_timer)
	if (open) {
		menu_anchor.value = true
		return
	}
	if (!explorer_settings.menu_animation) {
		menu_anchor.value = false
		return
	}
	menu_anchor_timer = window.setTimeout(() => { menu_anchor.value = false }, 120)
})
onBeforeUnmount(() => window.clearTimeout(menu_anchor_timer))
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
	? (system.value ? t(`system_folders.${system.value}`) : props.node.name)
	: props.item.root.name)
const hidden = computed(() => props.node ? entry_is_dimmed(props.node.name, props.node.id) : false)
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
	const own = folder_icon_of(own_read ?? entry.value?.xattrs)
	if (own) return { icon: shown_icon(own.icon), color: own.color || undefined, plain: !own.color }
	if (view_meta.value) return { icon: view_meta.value.icon, color: view_meta.value.color ?? undefined, plain: false }
	const standard = standard_folder_icon(row_ref.value, home.value)
	if (standard) return { icon: standard, color: undefined, plain: true }
	return { icon: expanded.value && children.value.length ? 'tabler:folder-open' : 'tabler:folder', color: undefined, plain: true }
})

/** This row's folder as an address, for the shared folder menu */
const row_ref = computed(() => ({ drive_id: props.item.drive.id, root_id: props.item.root.id, folder_id: folder_id.value }))

const root_key = computed(() => tree_root_key(props.item.drive.id, props.item.root.id))
const is_local = computed(() => props.item.drive.id === 'local')
/** The synced folder (pile) this row is in, on this computer */
const pile = computed(() => (is_local.value ? covering_link(normalize_workspace_id(folder_id.value))?.root : undefined))
/** This row is a synced folder or holds one: dropped into another, it joins it */
const holds_pile = computed(() => is_local.value && my_sync_roots().some(root => is_within(root, folder_id.value)))
const spot = computed(() => ({ root_key: root_key.value, folder_id: folder_id.value, ...(pile.value ? { pile: pile.value } : {}) }))

/**
 * The top folder of a pile (a synced folder) draws its whole region: its
 * children's guide becomes a line in the sync's state. Folders inside it
 * keep the plain guide, so the region reads as one
 */
const sync_status = computed(() => sync_status_of(row_ref.value))
const pile_line = computed(() => pile_line_state(shows_synced(row_ref.value), sync_status.value))
/** The cloud badge says what the sync does now, as the sync menu's button */
const badge = computed(() => sync_badge(sync_status.value))
/** The badge's own tip: the sync's state, or synced (and where) */
const badge_tip = computed(() => (badge.value.tip ? t(badge.value.tip) : synced_tip(row_ref.value)))
/** On the line: what the line is, then the sync's state when it says more than "synced" */
const pile_line_tip = computed(() => {
	const state = badge_tip.value
	return state === t('badge.synced') ? t('tree.sync_line') : `${t('tree.sync_line')} · ${state}`
})
/** A drag leaves this pile or goes into it: its region lights up */
const pile_lit = computed(() => {
	if (!pile_line.value || !tree_drag.source) return false
	return pile_crossing(tree_drag.source, tree_drag.target)?.pile === normalize_workspace_id(folder_id.value)
})
const drop_target = computed(() => is_drop_target(spot.value))
const dragged = computed(() => tree_drag.source?.root_key === root_key.value
	&& tree_drag.source.folder_id === folder_id.value)

/**
 * A cloud folder other people see too: the owner shared it out, or it is
 * someone else's folder shared with me. Only its top row says so
 */
const shared_tip = computed(() => {
	if (props.node || props.item.drive.kind !== 'cloud') return null
	const id = props.item.root.id
	if (cloud.shared_out[id]) return t('badge.shared')
	const role = cloud.role_of(id)
	if (role === 'viewer') return `${t('badge.shared_with_me')} · ${t('folder.view_only').toLowerCase()}`
	return role === 'editor' ? t('badge.shared_with_me') : null
})

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
 * Nested folders and cloud roots are drag sources. The chevron and the
 * menu keep their own clicks
 */
function press(event: PointerEvent) {
	const node = props.node
	// macOS's own folders stay where they are, as in Finder
	if (!row_can_drag({ can_write: can_write.value, system: !!system.value, folder: !!node, drive_kind: props.item.drive.kind })) return
	if (event.target instanceof Element && event.target.closest('.tg, .cv')) return
	// A press on a row starts a drag, not a text selection
	event.preventDefault()
	press_tree_row(event, {
		...spot.value,
		holds_pile: holds_pile.value,
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
		:class="{ sel: current, mo: menu_anchor, hid: hidden, drop: drop_target, drg: dragged || moving || cut }"
		:data-folder-id="folder_id"
		:data-drive-id="item.drive.id"
		:data-root-id="item.root.id"
		:data-drop-root="can_write ? root_key : undefined"
		:data-drop-folder="can_write ? folder_id : undefined"
		:data-drop-pile="can_write ? pile : undefined"
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
			<!-- In the colour of the line it heads, so the two read as one -->
			<span v-if="pile_line" class="bdg sync" :class="[pile_line, { spin: badge.spin, lit: pile_lit }]" :data-tip="badge_tip"><Icon :icon="badge.icon" /></span>
			<span v-if="is_bookmarked(row_ref)" class="bdg" :data-tip="t('badge.bookmarked')"><Icon icon="tabler:bookmark" /></span>
			<span v-if="shared_tip" class="bdg" :data-tip="shared_tip"><Icon icon="tabler:users" /></span>
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
	<div
		v-if="expanded && (children.length || loading)"
		class="g"
		:class="pile_line && ['pile', pile_line, { lit: pile_lit }]"
	>
		<!-- The line itself is drawn (::before) and takes no pointer: this strip over it says what it is -->
		<span v-if="pile_line" class="pl" :data-tip="pile_line_tip" data-tip-side="right" />
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
.bdg.spin :deep(svg) {
	animation: spin 1s linear infinite;
}
.r.sel .bdg {
	color: var(--text-accent);
}
/* The sync badge takes its line's colour, selected or not */
.bdg.sync.idle {
	color: var(--fill-accent);
}
.bdg.sync.syncing,
.bdg.sync.lit {
	color: var(--text-accent);
}
.bdg.sync.attention {
	color: var(--fill-warning);
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
/*
 * Children's guide: a hairline under the chevron's point (the row's margin
 * and padding plus half the chevron). Drawn, not a border, so a pile's
 * thicker line takes the same place and the rows never move
 */
.g {
	position: relative;
	margin-left: 13px;
	padding-left: 0.5px;
}
.g::before {
	content: '';
	position: absolute;
	left: 5px;
	top: 0;
	bottom: 0;
	width: 0.5px;
	background: var(--border);
	pointer-events: none;
}
/* A pile's region: the same guide, thicker and in the sync's state */
.g.pile::before {
	left: 4.5px;
	width: 1.5px;
	border-radius: 1px;
	background: var(--fill-accent);
}
.g.pile.attention::before {
	background: var(--fill-warning);
}
.g.pile.lit {
	background: var(--bg-accent);
}
.g.pile.lit::before {
	background: var(--text-accent);
}
/* Over the line, a few pixels wide: it thickens and says what it is */
.pl {
	position: absolute;
	z-index: 1;
	left: 1px;
	top: 0;
	bottom: 0;
	width: 8px;
	cursor: help;
}
.g.pile:has(> .pl:hover)::before {
	left: 4px;
	width: 2.5px;
}
/* Syncing: a dark run travels down a lighter line */
.g.pile.syncing::before {
	background:
		linear-gradient(to bottom, transparent, var(--text-accent) 50%, transparent) no-repeat,
		var(--border-accent);
	background-size: 100% 35%, 100% 100%;
	animation: pile-flow 1.1s linear infinite;
}
@keyframes pile-flow {
	from {
		background-position: 0 -55%, 0 0;
	}
	to {
		background-position: 0 155%, 0 0;
	}
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

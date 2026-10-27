<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { t } from '@/i18n'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { explorer_navigation } from '@/store/explorer/navigation'
import {
	explorer_tree,
	is_legacy_browser_folder,
	tree_root_folder_id,
	type ExplorerTreeRoot,
} from '@/store/explorer/tree'
import { arranged_children } from '@/store/explorer/tree_arrange'
import { show_hidden_files } from '@/store/showHiddenFiles'
import Button from '@/ui/kit/Button.vue'
import DropMenu from '@/ui/kit/DropMenu.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import Modal from '@/ui/kit/Modal.vue'
import RenameFolderDialog from './RenameFolderDialog.vue'

const props = defineProps<{
	item: ExplorerTreeRoot
	node?: WorkspaceTreeNode
}>()

const menu_open = ref(false)
const rename_open = ref(false)
const remove_open = ref(false)
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
const loading = computed(() => props.node
	? workspace.value?.is_folder_loading(folder_id.value) === true
		&& !explorer_tree.is_probing(props.item, folder_id.value)
	: props.item.loading)
const can_expand = computed(() => {
	if (loading.value) return true
	// A read folder shows what the filter leaves; an unread one, what the look-ahead found
	if (props.node?.children_loaded) return children.value.length > 0
	if (props.node) return explorer_tree.has_chevron(props.item, props.node, show_hidden_files.value)
	return !workspace.value || children.value.length > 0
})
const current = computed(() => {
	const location = explorer_navigation.location
	return location?.kind === 'folder'
		&& location.ref.drive_id === props.item.drive.id
		&& location.ref.root_id === props.item.root.id
		&& location.ref.folder_id === folder_id.value
})
const name = computed(() => props.node
	? explorer_tree.node_name(props.item, props.node)
	: props.item.root.name)
const hidden = computed(() => props.node ? is_hidden_entry_name(props.node.name) : false)
const can_write = computed(() => workspace.value?.can_write ?? props.item.root.can_write)
const can_rename = computed(() => props.node && !is_legacy_browser_folder(props.item, props.node))

watch(
	() => expanded.value ? [children.value, explorer_tree.round] as const : null,
	shown => { if (shown) explorer_tree.probe_folders(props.item, shown[0]) },
	{ immediate: true },
)

function toggle() {
	if (props.node) void explorer_tree.toggle_folder(props.item, props.node)
	else void explorer_tree.toggle_root(props.item)
}

function rename(new_name: string) {
	if (props.node) void explorer_tree.rename_folder(props.item, props.node, new_name)
}
</script>

<template>
	<div
		class="r"
		:class="{ sel: current, mo: menu_open, hid: hidden }"
		:data-folder-id="folder_id"
		:data-drive-id="item.drive.id"
		:data-root-id="item.root.id"
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
		<Icon :icon="expanded && children.length ? 'tabler:folder-open' : 'tabler:folder'" class="plain" />
		<span class="nm">{{ name }}</span>
		<span class="tg">
			<DropMenu v-if="can_write" v-model:open="menu_open" :width="240" align="start">
				<template #trigger>
					<span class="dt" :data-tip="t('tree.folder_menu')" @click.stop><Icon icon="tabler:dots" /></span>
				</template>
				<MenuItem
					icon="tabler:folder-plus"
					:label="t('menu.new_folder')"
					@select="explorer_tree.create_folder(item, node ?? null)"
				/>
				<template v-if="node">
					<MenuSeparator />
					<MenuItem
						v-if="can_rename"
						icon="tabler:pencil"
						:label="t('menu.rename')"
						@select="rename_open = true"
					/>
					<MenuItem
						icon="tabler:trash"
						:label="t('menu.move_to_trash')"
						@select="item.drive.trash === null ? remove_open = true : explorer_tree.remove_folder(item, node)"
					/>
				</template>
			</DropMenu>
		</span>
	</div>
	<div v-if="expanded && (children.length || loading)" class="g">
		<TreeRow v-for="child in children" :key="child.id" :item="item" :node="child" />
	</div>
	<RenameFolderDialog
		v-if="node"
		v-model:open="rename_open"
		:name="name"
		@confirm="rename"
	/>
	<Modal
		v-if="node && item.drive.trash === null"
		v-model:open="remove_open"
		:title="t('tree.delete_permanently_title')"
		:description="t('tree.delete_permanently_description', { name })"
	>
		<template #footer>
			<Button @click="remove_open = false">{{ t('dialog.cancel') }}</Button>
			<Button variant="danger" @click="remove_open = false; explorer_tree.remove_folder(item, node!)">
				{{ t('tree.delete_permanently') }}
			</Button>
		</template>
	</Modal>
</template>

<style scoped>
.r {
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
:global(.explorer.lg) .r {
	height: 38px;
}
:global(.explorer.lg) .r > :deep(svg) {
	font-size: 19px;
}
:global(.explorer.lg) .cv,
:global(.explorer.lg) .sp {
	width: 18px;
}
:global(.explorer.lg) .cv {
	font-size: 17px !important;
}
:global(.explorer.lg) .dt {
	width: 26px;
	height: 26px;
}
:global(.explorer.lg) .g {
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

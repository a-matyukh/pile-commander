<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, watch, watchEffect } from 'vue'
import { Icon } from '@iconify/vue'
import type { Drive } from '@/domain/Drive'
import { t } from '@/i18n'
import store from '@/store'
import { explorer_drives } from '@/store/explorer/drives'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_sidebar_width } from '@/store/explorer/sidebar'
import { explorer_tree, tree_root_folder_id } from '@/store/explorer/tree'
import { arranged_children, arranged_roots } from '@/store/explorer/tree_arrange'
import { TREE_FILTERS, explorer_tree_view, is_tree_filtered } from '@/store/explorer/tree_view'
import { report_error } from '@/store/helpers/reportError'
import HomeGlyph from '@/ui/explorer/HomeGlyph.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import SidebarResizer from './SidebarResizer.vue'
import TreeMenus from './TreeMenus.vue'
import TreeRow from './TreeRow.vue'

const drives = computed(() => explorer_drives.drives())
const hub_open = computed(() => {
	const location = explorer_navigation.location
	return location?.kind === 'page' && location.page === 'hub'
})
const active_source = computed(() => {
	if (hub_open.value) return 'hub'
	const location = explorer_navigation.location
	return location?.kind === 'folder' ? location.ref.drive_id : null
})
const active_drive = computed(() => drives.value.find(item => item.id === active_source.value) ?? null)
const primary_root = computed(() => active_drive.value?.kind === 'cloud' ? null : explorer_tree.roots[0] ?? null)
const primary_children = computed(() => {
	const root = primary_root.value
	return root ? arranged_children(root, tree_root_folder_id(root), root.workspace?.tree ?? []) : []
})
const separate_roots = computed(() => {
	if (active_drive.value?.kind === 'local') return arranged_roots(explorer_tree.roots.slice(1))
	return active_drive.value?.kind === 'cloud' ? arranged_roots(explorer_tree.roots) : []
})
const filtered = computed(() => is_tree_filtered(explorer_tree_view.value))
/** Roots listed and their stores read: before that an empty tree means "not yet", not "none" */
const tree_ready = computed(() => explorer_tree.listed_drive_id === active_drive.value?.id
	&& explorer_tree.roots.every(item => !item.loading)
	&& (!primary_root.value || primary_root.value.workspace !== null))
const nothing_found = computed(() => filtered.value && tree_ready.value
	&& !primary_children.value.length && !separate_roots.value.length)

function source_is_open(drive: Drive): boolean {
	const location = explorer_navigation.location
	if (location?.kind !== 'folder' || location.ref.drive_id !== drive.id) return false
	const root_folder_id = drive.kind === 'cloud' ? '/' : location.ref.root_id
	return location.ref.folder_id === root_folder_id
}

async function open_drive(drive: Drive) {
	try {
		const root = (await drive.roots())[0]
		if (!root) return
		await explorer_navigation.open_folder({
			drive_id: drive.id,
			root_id: root.id,
			folder_id: drive.kind === 'cloud' ? '/' : root.id,
		})
	} catch (error) {
		report_error(store, error)
	}
}

watch(() => [primary_children.value, explorer_tree.round] as const, ([nodes]) => {
	if (primary_root.value) explorer_tree.probe_folders(primary_root.value, nodes)
}, { immediate: true })

// Back from Finder: what changed in collapsed folders shows up now
useEventListener(window, 'focus', () => explorer_tree.refresh_shown())

watchEffect(() => {
	const location = explorer_navigation.location
	const drive = active_drive.value
	if (!drive) {
		explorer_tree.show_page()
		return
	}
	void explorer_tree.show_drive(drive, location?.kind === 'folder' ? location.ref : null)
})
</script>

<template>
	<aside
		class="tree"
		:style="explorer_sidebar_width ? { width: explorer_sidebar_width + 'px' } : undefined"
	>
		<SidebarResizer />
		<div class="hd">
			<IconButton
				v-for="drive in drives"
				:key="drive.id"
				:icon="drive.kind === 'local' ? undefined : drive.icon"
				:selected="source_is_open(drive)"
				:class="{ cur: active_source === drive.id }"
				:aria-label="drive.name"
				:data-tip="drive.name"
				@click="open_drive(drive)"
			>
				<HomeGlyph v-if="drive.kind === 'local'" :size="18" />
			</IconButton>
			<IconButton
				icon="tabler:world"
				:selected="hub_open"
				:class="{ cur: active_source === 'hub' }"
				:aria-label="t('source.hub')"
				:data-tip="t('source.hub')"
				@click="explorer_navigation.open_page('hub')"
			/>
		</div>
		<div class="tls">
			<template v-if="!hub_open">
				<template v-if="primary_root">
					<TreeRow
						v-for="node in primary_children"
						:key="node.id"
						:item="primary_root"
						:node="node"
					/>
				</template>
				<div v-if="primary_root && separate_roots.length" class="sr" />
				<TreeRow
					v-for="item in separate_roots"
					:key="`${item.drive.id}:${item.root.id}`"
					:item="item"
				/>
				<div v-if="nothing_found" class="none">{{ t('tree.nothing_found') }}</div>
			</template>
		</div>
		<template v-if="!hub_open">
			<div v-if="filtered" class="chip">
				<Icon :icon="TREE_FILTERS[explorer_tree_view.filter].icon" />
				{{ t(`filter.${explorer_tree_view.filter}`) }}
				<button type="button" class="reset" @click="explorer_tree_view.filter = 'all'">{{ t('tree.reset') }}</button>
			</div>
			<div class="tb">
				<TreeMenus />
			</div>
		</template>
	</aside>
</template>

<style scoped>
.tree {
	position: relative;
	width: 244px;
	flex: none;
	border-right: 0.5px solid var(--border);
	display: flex;
	flex-direction: column;
	background: var(--pn);
	min-height: 0;
}
.tls {
	padding: 6px 0 8px;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
}
.hd {
	display: flex;
	align-items: center;
	justify-content: space-between;
	height: 46px;
	box-sizing: border-box;
	padding: 0 6px;
	border-bottom: 0.5px solid var(--border);
	flex: none;
}
.hd .ib {
	height: 30px;
	min-width: 36px;
	position: relative;
}
.hd .ib :deep(svg) {
	font-size: 18px;
}
.hd .ib.cur {
	color: var(--text-primary);
}
.hd .ib.sel {
	color: var(--text-accent);
}
.hd .ib.cur::after {
	content: '';
	position: absolute;
	left: 8px;
	right: 8px;
	bottom: -8px;
	height: 2px;
	border-radius: 1px;
	background: var(--text-primary);
}
.none {
	padding: 24px 12px;
	text-align: center;
	font-size: 12px;
	color: var(--text-muted);
}
.chip {
	display: flex;
	align-items: center;
	gap: 6px;
	margin: 0 12px 6px;
	font-size: 11px;
	color: var(--text-accent);
	flex: none;
}
.chip :deep(svg) {
	font-size: 13px;
}
.reset {
	margin-left: auto;
	border: 0;
	padding: 0;
	background: none;
	font: inherit;
	cursor: pointer;
	color: var(--text-secondary);
}
.tb {
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 4px 6px;
	border-top: 0.5px solid var(--border);
	flex: none;
}
.tb :deep(.ib) {
	height: 30px;
	min-width: 30px;
}
.tb :deep(.ib svg) {
	font-size: 17px;
}
.sr {
	height: 0.5px;
	margin: 6px 10px;
	background: var(--border);
}
:global(.explorer.lg) .tree {
	width: 280px;
}
:global(.explorer.lg) .hd {
	height: 56px;
}
:global(.explorer.lg) .hd .ib {
	height: 38px;
	min-width: 44px;
}
:global(.explorer.lg) .hd .ib :deep(svg) {
	font-size: 21px;
}
:global(.explorer.lg) .hd .ib :deep(.hm) {
	font-size: 21px !important;
}
:global(.explorer.lg) .hd .ib.cur::after {
	bottom: -9px;
}
</style>

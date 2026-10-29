<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import app_store from '@/store'
import { report_error } from '@/store/helpers/reportError'
import { t } from '@/i18n'
import { parent_folder_id_from_node_id } from '@/services/workspace/paths'
import { FOLDER_ICON_COLORS, folder_icon_of, write_folder_icon, type FolderIcon } from '@/store/explorer/folder_cover'
import { RECOMMENDED_ICONS, load_all_icons, search_icons, shown_icon } from '@/store/explorer/icon_catalog'
import { explorer_tree, tree_root_folder_id, type ExplorerTreeRoot } from '@/store/explorer/tree'
import MenuItem from '@/ui/kit/MenuItem.vue'
import ColorPanel from './ColorPanel.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import MenuSub from '@/ui/kit/MenuSub.vue'

/**
 * A folder's look in its menu, kept apart as in Finder and Milanote: its
 * icon (any of tabler's, found by name, in a color or monochrome) and its
 * cover (a color or a picture: its tile on a board, as the current app's
 * "Cover")
 */
const props = defineProps<{
	/** The tree's root of the folder; a board passes its store instead */
	item?: ExplorerTreeRoot | null
	folder: FolderRef
	/** The store showing the folder (a board's): read and written there, so its card changes at once */
	store?: WorkspaceStore | null
}>()

/** Written on the folder itself: its own read first, then its parent's listing */
const xattrs = computed(() => {
	const store = props.store ?? props.item?.workspace
	if (!store) return undefined
	const own = store.folders[props.folder.folder_id]?.xattrs
	if (own) return own
	const root_folder_id = props.item ? tree_root_folder_id(props.item) : store.id
	const parent = store.folders[parent_folder_id_from_node_id(props.folder.folder_id, root_folder_id)]
	return parent?.children.find(child => child.id === props.folder.folder_id)?.xattrs
})
const icon = computed(() => folder_icon_of(xattrs.value))
const cover = computed(() => {
	const value = xattrs.value?.find(xattr => xattr.name === 'cover')?.value
	return value && value !== 'none' ? value : ''
})

/** The board's store writes on the folder itself, so it reads the folder first, as the tree does */
async function in_store(write: (store: WorkspaceStore) => Promise<void>) {
	const store = props.store!
	try {
		if (!store.resolve_folder_data(props.folder.folder_id)) await store.show_folder_children(props.folder.folder_id, undefined, { silent: true })
		await write(store)
	} catch (error) {
		report_error(app_store, error)
	}
}

function write_icon(value: string) {
	if (props.store) void in_store(store => store.change_folder_icon(props.folder.folder_id, value))
	else if (props.item) void explorer_tree.set_folder_icon(props.item, props.folder.folder_id, value)
}

function set_icon(next: Partial<FolderIcon>) {
	const value = { icon: icon.value?.icon ?? 'tabler:folder', color: icon.value?.color ?? '', ...next }
	write_icon(write_folder_icon(value))
}

function reset_icon() {
	write_icon('none')
}

/** Search by name, as Milanote's: all of tabler's load on the first letter */
const query = ref('')
const names = ref<string[] | null>(null)
watch(query, (value) => {
	if (value.trim() && !names.value) void load_all_icons().then((all) => { names.value = all })
})
const shown = computed(() => query.value.trim() ? search_icons(names.value ?? [], query.value) : RECOMMENDED_ICONS)
const searching = computed(() => query.value.trim() !== '' && names.value === null)

/**
 * The field takes the keys as soon as its submenu opens. The menu focuses
 * its own content on open, so the field takes the focus right after it
 */
const vFocus = { mounted: (el: HTMLElement) => { requestAnimationFrame(() => el.focus()) } }

function set_cover(value: string) {
	const cover = value.trim() || 'none'
	if (props.store) void in_store(store => store.change_folder_cover(props.folder.folder_id, cover))
	else if (props.item) void explorer_tree.set_folder_cover(props.item, props.folder.folder_id, cover)
}
</script>

<template>
	<MenuSub :icon="icon ? shown_icon(icon.icon) : 'tabler:icons'" :label="t('style.icon')" :width="284">
		<MenuLabel :label="t('style.icon_color')" />
		<div class="swr">
			<button
				v-for="color in FOLDER_ICON_COLORS"
				:key="color || 'none'"
				type="button"
				class="swc"
				:class="{ on: (icon?.color ?? '') === color }"
				:style="{ background: color || 'var(--surface-0)' }"
				:aria-label="color || t('style.no_color')"
				:data-tip="color ? undefined : t('style.no_color')"
				@click="set_icon({ color })"
			/>
		</div>
		<div class="sr">
			<Icon icon="tabler:search" class="sri" />
			<input
				v-model="query"
				v-focus
				class="in"
				:placeholder="t('style.search_icons')"
				spellcheck="false"
				@keydown.stop
			>
		</div>
		<div class="grid">
			<button
				v-for="name in shown"
				:key="name"
				type="button"
				class="swi"
				:class="{ on: icon?.icon === name }"
				:aria-label="name.slice(7)"
				:data-tip="name.slice(7)"
				@click="set_icon({ icon: name })"
			>
				<Icon :icon="name" :style="{ color: icon?.color || undefined }" />
			</button>
		</div>
		<p v-if="searching" class="hn"><Icon icon="tabler:loader-2" class="spin" /></p>
		<p v-else-if="!shown.length" class="hn">{{ t('style.no_icons') }}</p>
		<MenuItem v-if="icon" icon="tabler:arrow-back-up" :label="t('style.default_icon')" @select="reset_icon" />
	</MenuSub>
	<MenuSub icon="tabler:photo" :label="t('style.cover')" :width="208">
		<ColorPanel :value="cover" :label="t('style.cover_color')" picture :reset_label="t('style.remove_cover')" @set="set_cover" />
	</MenuSub>
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
.sr {
	position: relative;
	padding: 2px 6px 6px;
}
.sri {
	position: absolute;
	left: 14px;
	top: 9px;
	font-size: 14px;
	color: var(--text-muted);
	pointer-events: none;
}
.sr .in {
	width: 100%;
	padding-left: 28px;
}
.in {
	box-sizing: border-box;
	height: 28px;
	padding: 0 8px;
	border: 0.5px solid var(--border-strong);
	border-radius: 6px;
	background: var(--surface-2);
	font: inherit;
	font-size: 12px;
	color: var(--text-primary);
	outline: none;
}
.in:focus {
	border-color: var(--border-accent);
}
.grid {
	display: grid;
	grid-template-columns: repeat(8, 30px);
	gap: 2px;
	padding: 0 6px 6px;
	max-height: 196px;
	overflow-y: auto;
}
.swi {
	width: 30px;
	height: 30px;
	border: 0;
	padding: 0;
	border-radius: 6px;
	background: none;
	display: flex;
	align-items: center;
	justify-content: center;
	cursor: pointer;
	color: var(--text-secondary);
	font-size: 18px;
}
.swi.on {
	background: var(--bg-accent);
	color: var(--text-accent);
}
.hn {
	margin: 0;
	padding: 0 8px 6px;
	font-size: 11px;
	line-height: 1.4;
	color: var(--text-muted);
	white-space: normal;
}
.spin {
	animation: spin 1s linear infinite;
}
@keyframes spin {
	to {
		transform: rotate(360deg);
	}
}
@media (hover: hover) {
	.swi:hover {
		background: var(--surface-1);
	}
}
</style>

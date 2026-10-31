<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import { computed, ref, watch, watchEffect } from 'vue'
import { Icon } from '@iconify/vue'
import type { Drive } from '@/domain/Drive'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import store from '@/store'
import cloud from '@/store/cloud'
import { explorer_drives } from '@/store/explorer/drives'
import { explorer_drive_locations, explorer_last_location, explorer_navigation } from '@/store/explorer/navigation'
import { explorer_settings } from '@/store/explorer/settings'
import { explorer_drawer_open, explorer_sidebar_width } from '@/store/explorer/sidebar'
import { explorer_tree, tree_root_folder_id } from '@/store/explorer/tree'
import { arranged_children, arranged_roots } from '@/store/explorer/tree_arrange'
import { TREE_FILTERS, explorer_tree_view, is_tree_filtered } from '@/store/explorer/tree_view'
import { report_error } from '@/store/helpers/reportError'
import HomeGlyph from '@/ui/explorer/HomeGlyph.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import SidebarResizer from './SidebarResizer.vue'
import TreeMenus from './TreeMenus.vue'
import TreeRow from './TreeRow.vue'
import { cloud_source_opens_page } from './source_open'
import { CLOUD_ROOT_DROP_KEY, is_drop_target, tree_drag, tree_root_key } from './tree_drag'

/** On phones the sidebar is a drawer over the content, as in the prototype */
defineProps<{ drawer?: boolean }>()

const drives = computed(() => explorer_drives.drives())
/** The account or settings page is open: its footer button shows it */
function page_open(page: 'account' | 'settings' | 'trash' | 'cloud') {
	const location = explorer_navigation.location
	return location?.kind === 'page' && location.page === page
}

const cloud_signed_in = computed(() => !!cloud.user)

const hub_open = computed(() => {
	const location = explorer_navigation.location
	// An author's page belongs to the Hub
	return location?.kind === 'page' && (location.page === 'hub' || location.page === 'profile')
})
/**
 * The source the user just picked. The switch is instant, as in the
 * prototype: the tree shows that drive (with a spinner while it lists its
 * folders) before the navigation to its first folder has finished
 */
const picked_source = ref<string | null>(null)
/** The open folder; on a page (settings, account) the last one, so its tree stays */
const shown_folder = computed(() => {
	const location = explorer_navigation.location
	if (location?.kind === 'folder') return location.ref
	return location?.kind === 'page' ? explorer_last_location.value : null
})
const active_source = computed(() => {
	if (picked_source.value) return picked_source.value
	if (hub_open.value) return 'hub'
	// The trash and the cloud page are the cloud's: its tree stays beside them
	if (page_open('trash') || page_open('cloud')) return 'cloud'
	return shown_folder.value?.drive_id ?? null
})
/** A source, or a publication / the demo: those have a tree of their own, but no source button */
const active_drive = computed(() => active_source.value && active_source.value !== 'hub'
	? explorer_drives.drive(active_source.value)
	: null)
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
/** The empty space takes drops into the main root, or creates a cloud root */
const primary_spot = computed(() => {
	if (active_drive.value?.id === 'cloud') {
		return { root_key: CLOUD_ROOT_DROP_KEY, folder_id: '/' }
	}
	if (active_drive.value?.kind === 'cloud') return null
	const root = primary_root.value
	if (!root || root.workspace?.can_write === false) return null
	return { root_key: tree_root_key(root.drive.id, root.root.id), folder_id: tree_root_folder_id(root) }
})
/** Roots listed and their stores read: before that an empty tree means "not yet", not "none" */
const tree_ready = computed(() => explorer_tree.listed_drive_id === active_drive.value?.id
	&& explorer_tree.roots.every(item => !item.loading)
	&& (!primary_root.value || primary_root.value.workspace !== null))
const nothing_found = computed(() => filtered.value && tree_ready.value
	&& !primary_children.value.length && !separate_roots.value.length)

function source_is_open(drive: Drive): boolean {
	// The cloud's root is its page of top-level folders
	if (drive.kind === 'cloud') return page_open('cloud')
	const location = explorer_navigation.location
	if (location?.kind !== 'folder' || location.ref.drive_id !== drive.id) return false
	return location.ref.folder_id === location.ref.root_id
}

async function open_drive(drive: Drive) {
	const location = explorer_navigation.location
	// The cloud's own "root" is the page of its top-level folders: when the
	// cloud is already shown, or nothing in it was opened before. Signed out,
	// that page asks to sign in — a saved folder cannot be opened.
	if (drive.kind === 'cloud' && cloud_source_opens_page(
		cloud_signed_in.value,
		active_source.value,
		!!explorer_drive_locations.value.cloud,
	)) {
		void explorer_navigation.open_page('cloud')
		return
	}
	// The source already shown: its root, as Finder's Home. No switch, no spinner
	if (location?.kind === 'folder' && location.ref.drive_id === drive.id) {
		try {
			const root = (await drive.roots())[0]
			if (root) {
				await explorer_navigation.open_folder({
					drive_id: drive.id,
					root_id: root.id,
					folder_id: drive.kind === 'cloud' ? '/' : root.id,
				})
			}
		} catch (error) {
			report_error(store, error)
		}
		return
	}
	picked_source.value = drive.id
	switching.value = true
	// Never stuck behind the spinner: a slow or failed switch shows what there is
	if (switch_guard) clearTimeout(switch_guard)
	switch_guard = setTimeout(() => { switching.value = false }, 15_000)
	try {
		const root = (await drive.roots())[0]
		if (!root) return
		await explorer_navigation.open_drive({
			drive_id: drive.id,
			root_id: root.id,
			folder_id: drive.kind === 'cloud' ? '/' : root.id,
		})
	} catch (error) {
		report_error(store, error)
	} finally {
		// Another pick meanwhile owns the switch
		if (picked_source.value === drive.id) picked_source.value = null
	}
}

/** "This Mac" has no trash page: its button opens the Finder's trash */
async function open_finder_trash() {
	try {
		const [{ homeDir }, { openPath }] = await Promise.all([
			import('@tauri-apps/api/path'),
			import('@tauri-apps/plugin-opener'),
		])
		await openPath(`${await homeDir()}/.Trash`)
	} catch (error) {
		report_error(store, error)
	}
}

function open_hub() {
	picked_source.value = null
	switching.value = false
	void explorer_navigation.open_page('hub')
}

/** The spinner waits a moment: a quick list should not flash it */
const listing = computed(() => !!active_drive.value && explorer_tree.listed_drive_id !== active_drive.value.id)

/**
 * From a click on a source until its tree is final — listed, navigated to
 * its first folder, that folder's root open and expanded — the user sees
 * only a spinner, not the old drive's tree or the steps in between
 */
const switching = ref(false)
const settled = computed(() => {
	const drive = active_drive.value
	if (!drive || picked_source.value || explorer_tree.listed_drive_id !== drive.id) return false
	const location = explorer_navigation.location
	if (location?.kind !== 'folder' || location.ref.drive_id !== drive.id) return true
	const root = explorer_tree.roots.find(item => item.root.id === location.ref.root_id)
	return !root || (!root.loading && root.workspace !== null)
})
let switch_guard: ReturnType<typeof setTimeout> | null = null
watch(settled, now => {
	if (!now || !switching.value) return
	switching.value = false
	if (switch_guard) clearTimeout(switch_guard)
})
const show_spinner = ref(false)
let spinner_timer: ReturnType<typeof setTimeout> | null = null
watch(() => listing.value || switching.value, now => {
	if (spinner_timer) clearTimeout(spinner_timer)
	spinner_timer = null
	if (!now) {
		show_spinner.value = false
		return
	}
	spinner_timer = setTimeout(() => { show_spinner.value = true }, 250)
}, { immediate: true })

watch(() => [primary_children.value, explorer_tree.round] as const, ([nodes]) => {
	if (primary_root.value) explorer_tree.probe_folders(primary_root.value, nodes)
}, { immediate: true })

// Back from Finder: what changed in collapsed folders shows up now
useEventListener(window, 'focus', () => explorer_tree.refresh_shown())

watchEffect(() => {
	const drive = active_drive.value
	if (!drive) {
		explorer_tree.show_page()
		return
	}
	const folder = shown_folder.value
	void explorer_tree.show_drive(drive, folder?.drive_id === drive.id ? folder : null)
})
</script>

<template>
	<aside
		class="tree"
		:class="{ drawer, op: drawer && explorer_drawer_open }"
		:style="!drawer && explorer_sidebar_width ? { width: explorer_sidebar_width + 'px' } : undefined"
	>
		<SidebarResizer v-if="!drawer" />
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
				@click="open_hub"
			/>
		</div>
		<div
			class="tls"
			:class="{ drop: primary_spot && is_drop_target(primary_spot) }"
			:data-drop-root="primary_spot?.root_key"
			:data-drop-folder="primary_spot?.folder_id"
		>
			<template v-if="!hub_open && !switching">
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
			<!-- Switching drives or listing the roots: nothing but a spinner until the tree is final -->
			<div v-if="!hub_open && (switching || listing) && show_spinner" class="none">
				<Icon icon="tabler:loader-2" class="spin" />
			</div>
		</div>
		<template v-if="!hub_open">
			<div v-if="filtered" class="chip">
				<Icon :icon="TREE_FILTERS[explorer_tree_view.filter].icon" />
				{{ t(`filter.${explorer_tree_view.filter}`) }}
				<button type="button" class="reset" @click="explorer_tree_view.filter = 'all'">{{ t('tree.reset') }}</button>
			</div>
			<div class="tb">
				<TreeMenus />
				<!-- The cloud keeps a trash; "This Mac" opens the Finder's; browser storage has none -->
				<IconButton
					v-if="active_drive?.id === 'cloud' && cloud_signed_in"
					icon="tabler:trash"
					:label="explorer_settings.trash_button === 'text' ? t('trash.title') : undefined"
					:selected="page_open('trash')"
					:aria-label="t('page.trash')"
					:data-tip="t('page.trash')"
					class="trash"
					@click="explorer_navigation.open_page('trash')"
				/>
				<IconButton
					v-else-if="active_drive?.kind === 'local' && is_desktop"
					icon="tabler:trash"
					:label="explorer_settings.trash_button === 'text' ? t('trash.title') : undefined"
					:aria-label="t('trash.title')"
					:data-tip="t('trash.title')"
					class="trash"
					@click="open_finder_trash"
				/>
			</div>
		</template>
		<div class="ft">
			<IconButton
				v-for="page in (['account', 'settings'] as const)"
				:key="page"
				:icon="explorer_settings.footer_buttons !== 'text' ? (page === 'account' ? 'tabler:user-circle' : 'tabler:settings') : undefined"
				:label="explorer_settings.footer_buttons !== 'icon' ? t(`page.${page}`) : undefined"
				:selected="page_open(page)"
				:aria-label="t(`page.${page}`)"
				:data-tip="t(`page.${page}`)"
				@click="explorer_navigation.open_page(page)"
			/>
		</div>
		<div
			v-if="tree_drag.source"
			class="gh"
			:style="{ left: tree_drag.x + 12 + 'px', top: tree_drag.y + 8 + 'px' }"
		>
			<Icon icon="tabler:folder" />
			<span>{{ tree_drag.source.name }}</span>
		</div>
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
/* phone drawer */
.tree.drawer {
	position: absolute;
	top: 0;
	left: 0;
	bottom: 0;
	width: min(286px, 86%);
	z-index: 4;
	border-right: none;
	transform: translateX(-100%);
	visibility: hidden;
	transition: transform .22s ease, visibility 0s .22s;
}
.tree.drawer.op {
	transform: none;
	visibility: visible;
	box-shadow: 6px 0 24px rgba(0, 0, 0, .12);
	border-right: 0.5px solid var(--border-strong);
	transition: transform .22s ease;
}
.tls {
	padding: 6px 0 8px;
	flex: 1;
	min-height: 0;
	overflow-y: auto;
}
.tls.drop {
	box-shadow: inset 0 0 0 1px var(--border-accent);
}
.gh {
	position: fixed;
	z-index: 50;
	display: flex;
	align-items: center;
	gap: 6px;
	max-width: 220px;
	padding: 4px 8px;
	border-radius: 6px;
	background: var(--surface-2);
	box-shadow: 0 2px 10px rgba(0, 0, 0, .15);
	font-size: 12px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	pointer-events: none;
}
:global(body.tree-dragging) {
	cursor: grabbing;
	user-select: none;
	-webkit-user-select: none;
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
.spin {
	animation: tree-spin 0.8s linear infinite;
	font-size: 16px;
}
@keyframes tree-spin {
	to { transform: rotate(360deg); }
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
.tb .trash {
	margin-left: auto;
}
.ft {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 2px;
	padding: 4px 6px;
	border-top: 0.5px solid var(--border);
	flex: none;
}
.ft :deep(.ib) {
	height: 30px;
	min-width: 30px;
}
.ft :deep(.ib svg) {
	font-size: 17px;
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
.explorer.lg .tree {
	width: 280px;
}
.explorer.lg .hd {
	height: 56px;
}
.explorer.lg .hd .ib {
	height: 38px;
	min-width: 44px;
}
.explorer.lg .hd .ib :deep(svg) {
	font-size: 21px;
}
.explorer.lg .hd .ib :deep(.hm) {
	font-size: 21px !important;
}
.explorer.lg .hd .ib.cur::after {
	bottom: -9px;
}
</style>

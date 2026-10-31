<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useEventListener, useMediaQuery } from '@vueuse/core'
import { locale, t } from '@/i18n'
import { report_error } from '@/store/helpers/reportError'
import { start_explorer_list_migration } from '@/store/explorer/bookmarks'
import { explorer_drives } from '@/store/explorer/drives'
import { explorer_navigation } from '@/store/explorer/navigation'
import store, { adopt_workspace } from '@/store'
import { explorer_settings } from '@/store/explorer/settings'
import SettingsPage from '@/ui/explorer/pages/SettingsPage.vue'
import AccountPage from '@/ui/explorer/pages/AccountPage.vue'
import TrashPage from '@/ui/explorer/pages/TrashPage.vue'
import CloudPage from '@/ui/explorer/pages/CloudPage.vue'
import FolderContent from '@/ui/explorer/FolderContent.vue'
import HubPage from '@/ui/explorer/pages/hub/HubPage.vue'
import ProfilePage from '@/ui/explorer/pages/hub/ProfilePage.vue'
import cloud from '@/store/cloud'
import { explorer_mounted, take_explorer_start } from '@/store/explorer/public_view'
import TooltipLayer from '@/ui/kit/TooltipLayer.vue'
import TopBar from '@/ui/explorer/top-bar/TopBar.vue'
import PublishDialog from '@/ui/workspace/sidebar/PublishDialog.vue'
import ShareDialog from '@/ui/workspace/sidebar/ShareDialog.vue'
import { publish_dialog, share_dialog, unlock_pointers } from './dialogs'
import { set_open_cloud_copy, take_bridge_intent } from '@/store/bridge'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import Sidebar from '@/ui/explorer/sidebar/Sidebar.vue'
import { tree_drag } from '@/ui/explorer/sidebar/tree_drag'
import FolderHeader from '@/ui/explorer/folder-header/FolderHeader.vue'
import { explorer_drawer_open, explorer_mobile, explorer_sidebar_open } from '@/store/explorer/sidebar'
import { explorer_tree } from '@/store/explorer/tree'
import './tokens.css'

const previous_lang = document.documentElement.lang
const restore_workspace = store.workspace
let alive = true

/** The interface settings that shape the whole window, as the prototype's window classes */
const window_classes = computed(() => ({
	gr: explorer_settings.gray_panels,
	cg: explorer_settings.gray_content,
	lg: explorer_settings.size === 'large',
	thin: explorer_settings.text_smoothing === 'thin',
	manim: explorer_settings.menu_animation,
	mshadow: explorer_settings.menu_shadow,
}))

const page = computed(() => {
	const location = explorer_navigation.location
	return location?.kind === 'page' ? location.page : null
})
const page_arg = computed(() => {
	const location = explorer_navigation.location
	return location?.kind === 'page' ? location.arg ?? null : null
})

// The Hub's list of publications loads when the page opens, as the old window's Hub did
watch(page, (value) => {
	if (value === 'hub' && cloud.is_configured) void cloud.fetch_hub()
}, { immediate: true })

// A phone's drawer gets out of the way once a folder or a page opens, as in the prototype
watch(() => explorer_navigation.location, () => { explorer_drawer_open.value = false })

const shell_error = computed(() => store.workspace?.last_error ?? store.last_error)

function dismiss_error() {
	store.workspace?.clear_error()
	store.clear_error()
}

/** How long the pointer must rest on the left edge before the sidebar slides in */
const PEEK_SHOW_MS = 120
/** After the pointer leaves, long enough to cross from the edge onto the sidebar */
const PEEK_HIDE_MS = 300
/** While a menu, a dialog, or a folder drag holds it open, look again until the pointer can dismiss it */
const PEEK_HOLD_MS = 200

const fine_pointer = useMediaQuery('(hover: hover) and (pointer: fine)')
const root_el = ref<HTMLElement | null>(null)
const edge_el = ref<HTMLElement | null>(null)
/** The closed sidebar, drawn over the page. Not the saved open flag */
const peek = ref(false)

let inside_edge = false
let inside_sidebar = false
let last_x = -1
let last_y = -1
let show_timer: ReturnType<typeof setTimeout> | null = null
let hide_timer: ReturnType<typeof setTimeout> | null = null

/** A mouse on a wide window, and the sidebar is pinned shut */
function peek_allowed() {
	return !explorer_mobile.value && !explorer_sidebar_open.value && fine_pointer.value
}

function clear_show() {
	if (show_timer) clearTimeout(show_timer)
	show_timer = null
}

function clear_hide() {
	if (hide_timer) clearTimeout(hide_timer)
	hide_timer = null
}

function release_peek() {
	peek.value = false
	inside_edge = false
	inside_sidebar = false
	clear_show()
	clear_hide()
}

function pointer_in_sidebar(target: Element | null): boolean {
	if (!target || target.closest('.gh')) return false
	const aside = target.closest('aside.tree')
	return !!aside && !aside.classList.contains('drawer')
}

/** A menu, a dialog, or its dimmer covers the page: the edge underneath is not what the pointer is on */
function pointer_on_layer(target: Element | null): boolean {
	return !!target?.closest('.mn, [role="dialog"], .ov')
}

/**
 * A folder menu or a rename dialog portaled out of the sidebar, or a row being
 * dragged onto the page. The sidebar stays out until that finishes.
 */
function sidebar_ui_open(): boolean {
	const root = root_el.value
	if (!root) return false
	if (tree_drag.source) return true
	if (root.querySelector('aside.tree [data-state="open"]')) return true
	if (root.querySelector('.mn[data-state="open"]')) return true
	if (root.querySelector('[role="dialog"][data-state="open"]')) return true
	return false
}

/** Where the pointer is now: the hidden sidebar does not take the hit, the edge box does */
function read_pointer() {
	if (last_x < 0) {
		inside_edge = false
		inside_sidebar = false
		return
	}
	const edge = edge_el.value?.getBoundingClientRect()
	const hit = document.elementFromPoint(last_x, last_y)
	inside_sidebar = pointer_in_sidebar(hit)
	inside_edge = !!edge
		&& !inside_sidebar
		&& !pointer_on_layer(hit)
		&& last_x >= edge.left && last_x < edge.right
		&& last_y >= edge.top && last_y < edge.bottom
}

function sync_peek() {
	if (!alive || !peek_allowed()) {
		release_peek()
		return
	}
	if (inside_edge || inside_sidebar) {
		clear_hide()
		if (peek.value || show_timer) return
		show_timer = setTimeout(() => {
			show_timer = null
			if (!alive || !peek_allowed()) return
			read_pointer()
			if (inside_edge || inside_sidebar) peek.value = true
		}, PEEK_SHOW_MS)
		return
	}
	clear_show()
	if (!peek.value || hide_timer) return
	hide_timer = setTimeout(try_hide, sidebar_ui_open() ? PEEK_HOLD_MS : PEEK_HIDE_MS)
}

function try_hide() {
	hide_timer = null
	if (!alive || !peek_allowed()) return
	read_pointer()
	if (inside_edge || inside_sidebar) {
		sync_peek()
		return
	}
	if (sidebar_ui_open()) {
		hide_timer = setTimeout(try_hide, PEEK_HOLD_MS)
		return
	}
	peek.value = false
}

useEventListener(window, 'pointermove', (e: PointerEvent) => {
	last_x = e.clientX
	last_y = e.clientY
	if (!peek_allowed() || e.pointerType === 'touch') return
	// Most moves are over the page. The rect check is enough until the pointer
	// actually reaches the edge, or the sidebar is already out.
	if (!peek.value && !inside_edge && !inside_sidebar) {
		const edge = edge_el.value?.getBoundingClientRect()
		const on_edge = !!edge
			&& e.clientX >= edge.left && e.clientX < edge.right
			&& e.clientY >= edge.top && e.clientY < edge.bottom
		if (!on_edge) return
	}
	const was_edge = inside_edge
	const was_sidebar = inside_sidebar
	read_pointer()
	if (inside_edge === was_edge && inside_sidebar === was_sidebar) return
	sync_peek()
})

// Leaving the window does not move across the edge; the sidebar should not stay out.
// Forget the last point: a later check would still see it sitting on the edge.
useEventListener(window, 'pointerout', (e: PointerEvent) => {
	if (e.relatedTarget) return
	if (!inside_edge && !inside_sidebar && !peek.value) return
	last_x = -1
	last_y = -1
	inside_edge = false
	inside_sidebar = false
	sync_peek()
})

watch([explorer_sidebar_open, explorer_mobile, fine_pointer], () => {
	if (!peek_allowed()) release_peek()
})

// The old interface stays English. The document language follows the Explorer
// only while its shell is on screen.
watch(locale, (value) => {
	document.documentElement.lang = value
}, { immediate: true })

const toast = useToast()

/**
 * A folder just copied to the cloud (Share, Publish, Copy to cloud) opens
 * here as its cloud copy; then the dialog the copy started from
 */
async function open_cloud_copy(item: WorkspacesListItem) {
	await explorer_navigation.open_folder({ drive_id: 'cloud', root_id: item.id, folder_id: '/' })
	const intent = take_bridge_intent(item.id)
	if (!intent) return
	toast.add({
		title: t('share.copied'),
		description: intent.door === 'device' ? t('share.copied_device') : t('share.copied_text'),
		color: 'success',
		icon: 'i-lucide:cloud-upload',
	})
	if (intent.door === 'share') share_dialog.value?.open(item.id)
	if (intent.door === 'publish') publish_dialog.value?.open(item.id)
}

onMounted(async () => {
	explorer_mounted.value = true
	set_open_cloud_copy(open_cloud_copy)
	// First time the flag is on. Doing this at app start would freeze the
	// lists while the old window is still the one being edited.
	start_explorer_list_migration()
	// Back from a publication or an invitation, or /hub: there, not the last folder
	const start = take_explorer_start()
	try {
		if (start?.kind === 'page') await explorer_navigation.open_page(start.page, start.arg)
		else if (start?.kind === 'folder') await explorer_navigation.open_folder(start.ref)
		else await explorer_navigation.open_at_launch()
	} catch (error) {
		if (alive) report_error(store, error)
	}
	if (!alive) adopt_workspace(restore_workspace)
})

onUnmounted(() => {
	explorer_mounted.value = false
	alive = false
	clear_show()
	clear_hide()
	set_open_cloud_copy(null)
	explorer_navigation.cancel()
	explorer_tree.reset()
	explorer_drives.dispose_all()
	adopt_workspace(restore_workspace)
	document.documentElement.lang = previous_lang
})
</script>

<template>
	<!-- Replaces WorkspaceWindow while the flag is on. Menus and dialogs portal
	     into this element to inherit its tokens. -->
	<div ref="root_el" class="explorer flex h-full min-h-0 flex-col" :class="window_classes">
		<TopBar />
		<div class="body">
			<!-- The zone is only a measure. Clicks pass through to the page. -->
			<div v-if="peek_allowed()" ref="edge_el" class="edge" aria-hidden="true" />
			<Sidebar v-if="!explorer_mobile" :overlay="!explorer_sidebar_open" :shown="peek" />
			<main class="pv">
				<FolderHeader />
				<p v-if="shell_error" class="shell-error" role="alert">
					<span>{{ shell_error }}</span>
					<button type="button" @click="dismiss_error">{{ t('dialog.close') }}</button>
				</p>
				<div class="content">
					<SettingsPage v-if="page === 'settings'" />
					<AccountPage v-else-if="page === 'account'" />
					<TrashPage v-else-if="page === 'trash'" />
					<CloudPage v-else-if="page === 'cloud'" />
					<HubPage v-else-if="page === 'hub'" />
					<ProfilePage v-else-if="page === 'profile' && page_arg" :username="page_arg" />
					<FolderContent v-else-if="!page" />
				</div>
			</main>
		</div>
		<template v-if="explorer_mobile">
			<Sidebar drawer />
			<div v-if="explorer_drawer_open" class="bd" @click="explorer_drawer_open = false" />
		</template>
		<TooltipLayer />
		<!-- The old interface's dialogs, opened from the Share menu -->
		<ShareDialog :ref="dialog => share_dialog = dialog as never" @closed="unlock_pointers" />
		<PublishDialog :ref="dialog => publish_dialog = dialog as never" @closed="unlock_pointers" />
	</div>
</template>

<style scoped>
.explorer {
	position: relative;
}
.bd {
	position: absolute;
	inset: 0;
	background: rgba(0, 0, 0, .28);
	z-index: 3;
}
.body {
	position: relative;
	display: flex;
	flex: 1;
	min-height: 0;
	overflow: hidden;
}
/* Left edge of the content, under the top bar. Hovering it slides the closed sidebar in. */
.edge {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	width: 16px;
	pointer-events: none;
}
/* The content's own layers (a board's panels) stay under a phone's drawer */
.pv {
	isolation: isolate;
	position: relative;
	flex: 1;
	min-width: 0;
	min-height: 0;
	display: flex;
	flex-direction: column;
	background: var(--ct);
}
.content {
	flex: 1;
	min-height: 0;
	overflow: auto;
}
.shell-error {
	padding: 12px 16px 0;
	display: flex;
	align-items: center;
	gap: 12px;
	max-width: 36rem;
	margin: 0;
	color: var(--text-danger);
	font-size: 13px;
}
.shell-error button {
	border: 0;
	background: none;
	color: inherit;
	font: inherit;
	cursor: pointer;
	text-decoration: underline;
}
</style>

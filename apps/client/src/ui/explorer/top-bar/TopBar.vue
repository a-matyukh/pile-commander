<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import { t } from '@/i18n'
import { use_overlay_titlebar } from '@/services/window/macOverlayChrome'
import { traffic_inset_target } from '@/services/window/trafficInset'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_drawer_open, explorer_mobile, explorer_sidebar_open, toggle_explorer_sidebar } from '@/store/explorer/sidebar'
import IconButton from '@/ui/kit/IconButton.vue'
import { actions_on_top, explorer_settings, path_on_top } from '@/store/explorer/settings'
import Breadcrumbs from '@/ui/explorer/folder-header/Breadcrumbs.vue'
import FolderActions from '@/ui/explorer/folder-header/FolderActions.vue'
import { use_folder_place } from '@/ui/explorer/folder-header/use_folder_place'
import BookmarksBar from './BookmarksBar.vue'
import BookmarksDropdown from './BookmarksDropdown.vue'

const narrow = useMediaQuery('(max-width: 767px)')
const { location, workspace, crumbs, title } = use_folder_place()

const { macOS } = useKbd()
const overlay = use_overlay_titlebar()
// The bar spans the window, so it is the left edge under the traffic lights.
const window_drag = computed(() => overlay.enabled)
const inset = computed(() => traffic_inset_target({
	enabled: window_drag.value,
	fullscreen: overlay.fullscreen.value,
	gallery: false,
	sidebar_inline: false,
	sidebar_collapsed: false,
	drawer_open: false,
}) === 'header')

const shortcut = computed(() => (macOS.value
	? { back: '⌘←', forward: '⌘→', sidebar: '⌘B' }
	: { back: 'Alt+←', forward: 'Alt+→', sidebar: 'Alt+B' }))

defineShortcuts(computed(() => ({
	// Cmd on macOS, Alt elsewhere. meta would become Ctrl off a Mac.
	[macOS.value ? 'meta_b' : 'alt_b']: () => toggle_explorer_sidebar(),
	[macOS.value ? 'meta_arrowleft' : 'alt_arrowleft']: () => {
		void explorer_navigation.go_back()
	},
	[macOS.value ? 'meta_arrowright' : 'alt_arrowright']: () => {
		void explorer_navigation.go_forward()
	},
})))

function go_back() {
	if (!explorer_navigation.can_go_back) return
	void explorer_navigation.go_back()
}

function go_forward() {
	if (!explorer_navigation.can_go_forward) return
	void explorer_navigation.go_forward()
}
</script>

<template>
	<div
		class="bb"
		:class="{ inset }"
		:data-tauri-drag-region="window_drag ? '' : undefined"
	>
		<IconButton
			:icon="(explorer_mobile ? explorer_drawer_open : explorer_sidebar_open) ? 'tabler:layout-sidebar' : 'tabler:layout-sidebar-left-expand'"
			:aria-label="t('top.sidebar')"
			:data-tip="t('top.sidebar')"
			:data-tip-key="shortcut.sidebar"
			@click="toggle_explorer_sidebar"
		/>
		<IconButton
			icon="tabler:chevron-left"
			:disabled="!explorer_navigation.can_go_back"
			:aria-label="t('top.back')"
			:data-tip="t('top.back')"
			:data-tip-key="shortcut.back"
			class="back"
			@click="go_back"
		/>
		<IconButton
			icon="tabler:chevron-right"
			:disabled="!explorer_navigation.can_go_forward"
			:aria-label="t('top.forward')"
			:data-tip="t('top.forward')"
			:data-tip-key="shortcut.forward"
			@click="go_forward"
		/>
		<div v-if="explorer_settings.bookmarks_visible || path_on_top" class="vsep" />
		<template v-if="explorer_settings.bookmarks_visible">
			<BookmarksDropdown v-if="narrow || explorer_settings.bookmarks_style === 'list'" />
			<BookmarksBar v-else />
		</template>
		<template v-if="path_on_top && title">
			<div v-if="explorer_settings.bookmarks_visible" class="vsep" />
			<Breadcrumbs :crumbs="crumbs" :title="title" class="tpath" />
		</template>
		<div v-if="actions_on_top && workspace && location" class="rg">
			<FolderActions :workspace="workspace" :folder="location" :name="title" align="end" />
		</div>
	</div>
</template>

<style scoped>
.bb {
	display: flex;
	align-items: center;
	gap: 2px;
	height: 36px;
	flex: none;
	width: 100%;
	padding: 0 12px 0 8px;
	border-bottom: 0.5px solid var(--border);
	overflow: hidden;
	background: var(--pn);
	box-sizing: border-box;
}
.back {
	margin-left: 4px;
}
.bb.inset {
	padding-left: var(--pc-traffic-inset);
	/* macOS overlay: with trafficLightPosition { y: 25 } (tauri.conf.json) the
	   lights' centers sit 23.5px below the window top. A 47px bar centers the
	   buttons on that line. Measured on a screenshot; recheck if y changes. */
	height: 47px;
}
.tpath {
	flex: 1;
	min-width: 0;
	margin-left: 2px;
	font-size: 13px;
}
.explorer.lg .tpath {
	font-size: 15px;
}
.rg {
	margin-left: auto;
	display: flex;
	align-items: center;
	gap: 2px;
	flex: none;
	padding-left: 8px;
}
.vsep {
	width: 0.5px;
	height: 16px;
	background: var(--border-strong);
	margin: 0 6px;
	flex: none;
}
.explorer.lg .bb {
	height: 46px;
}
.explorer.lg .bb.inset {
	height: 47px;
}
</style>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
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
	<div class="explorer flex h-full min-h-0 flex-col" :class="window_classes">
		<TopBar />
		<div class="body">
			<Sidebar v-if="!explorer_mobile && explorer_sidebar_open" />
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
	display: flex;
	flex: 1;
	min-height: 0;
	overflow: hidden;
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

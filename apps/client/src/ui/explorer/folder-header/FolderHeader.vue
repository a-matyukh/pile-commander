<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import { normalize_workspace_id } from '@/services/workspace/paths'
import store from '@/store'
import { bookmark_name } from '@/store/explorer/bookmarks'
import { folder_basename, folder_crumbs, folder_title, type CrumbNames } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import Breadcrumbs from './Breadcrumbs.vue'
import FolderActions from './FolderActions.vue'

/**
 * The bar above the folder content: the path to the open folder, its title
 * and the folder actions. The prototype's default layout (two lines, full path)
 */

const home = ref<string | null>(null)
onMounted(async () => {
	if (!is_desktop) return
	const { homeDir } = await import('@tauri-apps/api/path')
	home.value = normalize_workspace_id(await homeDir())
})

const names = computed<CrumbNames>(() => ({
	is_home: root_id => home.value !== null && normalize_workspace_id(root_id) === home.value,
	root_name(ref: FolderRef) {
		if (ref.drive_id === 'local') {
			return home.value !== null && normalize_workspace_id(ref.root_id) === home.value
				? t('source.local')
				: folder_basename(ref.root_id)
		}
		if (ref.drive_id === 'browser') return t('source.browser_disk')
		return bookmark_name(ref)
	},
	folder_name: (ref: FolderRef) => ref.drive_id === 'browser' ? bookmark_name(ref) : folder_basename(ref.folder_id),
	cloud_name: t('source.cloud'),
}))

const location = computed(() => {
	const value = explorer_navigation.location
	return value?.kind === 'folder' ? value.ref : null
})
/** The store on screen, once it has opened the folder the location names */
const workspace = computed(() => {
	const ref = location.value
	const current = store.workspace
	if (!ref || !current || current.is_disposed) return null
	return current.opened_folder_id === ref.folder_id ? current : null
})
const crumbs = computed(() => location.value ? folder_crumbs(location.value, names.value) : [])
const title = computed(() => location.value ? folder_title(location.value, names.value) : '')
</script>

<template>
	<div v-if="location" class="ph0">
		<!-- Kept when empty (at a root): the title row stays in place -->
		<Breadcrumbs :crumbs="crumbs" />
		<div class="hrow">
			<div class="ttl">{{ title }}</div>
			<FolderActions v-if="workspace" :workspace="workspace" :folder="location" :name="title" align="end" />
		</div>
	</div>
</template>

<style scoped>
.ph0 {
	padding: 14px 16px 10px;
	border-bottom: 0.5px solid var(--border);
	background: var(--pn);
	flex: none;
}
.hrow {
	display: flex;
	align-items: center;
	gap: 4px;
	margin-top: 4px;
}
.ttl {
	font-size: 18px;
	font-weight: 500;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	margin-right: auto;
	min-width: 0;
}
:global(.explorer.lg) .ttl {
	font-size: 21px;
}
</style>

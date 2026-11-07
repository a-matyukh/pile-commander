<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import { actions_on_top, explorer_settings, path_in_header, path_on_top } from '@/store/explorer/settings'
import Breadcrumbs from './Breadcrumbs.vue'
import FolderActions from './FolderActions.vue'
import PlaceSubtitle from './PlaceSubtitle.vue'
import { use_folder_place } from './use_folder_place'

/**
 * The bar above the folder content: path, title and folder actions, shaped
 * by the path settings as in the prototype. With the path in the top bar it
 * holds the actions alone, or goes away when they moved to the top bar too.
 * A page (settings, account, Hub) shows its title and a subtitle
 */
const { location, page, page_arg, workspace, crumbs, title, folder_name } = use_folder_place()

/** Path and title are shown here; a page shows its title unless the path is on top */
const shows_place = computed(() => path_in_header.value || (!!page.value && !path_on_top.value))
const compact = computed(() => explorer_settings.header_style === 'compact' || (!!page.value && !explorer_settings.path_full))
const visible = computed(() => (location.value || page.value) && (shows_place.value || (!actions_on_top.value && !!workspace.value)))
/**
 * The folder shows what was kept (memory or this device) while the cloud is
 * read again: a quiet mark by the title, only if that takes a moment
 */
const refreshing = computed(() => !!workspace.value && !!location.value
	&& workspace.value.refreshing_folder_id === location.value.folder_id)
</script>

<template>
	<template v-if="visible">
		<div v-if="shows_place && compact" class="ph0 cp">
			<div class="hrow">
				<Breadcrumbs :crumbs="crumbs" :title="title" />
				<Icon v-if="refreshing" icon="tabler:loader-2" class="rfm" :title="t('folder.refreshing')" :aria-label="t('folder.refreshing')" />
				<FolderActions v-if="workspace && location" :workspace="workspace" :folder="location" :name="folder_name" align="end" />
			</div>
		</div>

		<div v-else-if="shows_place" class="ph0" :class="{ nt: !explorer_settings.path_full }">
			<template v-if="explorer_settings.path_full">
				<PlaceSubtitle v-if="page" :page="page" :arg="page_arg" />
				<!-- Kept when empty (at a root): the title row stays in place -->
				<Breadcrumbs v-else :crumbs="crumbs" />
			</template>
			<div class="hrow">
				<div class="ttl">{{ title }}</div>
				<Icon v-if="refreshing" icon="tabler:loader-2" class="rfm" :title="t('folder.refreshing')" :aria-label="t('folder.refreshing')" />
				<FolderActions v-if="workspace && location" :workspace="workspace" :folder="location" :name="folder_name" align="end" />
			</div>
		</div>

		<div v-else-if="workspace && location" class="ph0 cp lft">
			<div class="hrow">
				<FolderActions :workspace="workspace" :folder="location" :name="folder_name" align="start" />
			</div>
		</div>
	</template>
</template>

<style scoped>
.ph0 {
	padding: 14px 16px 10px;
	border-bottom: 0.5px solid var(--border);
	background: var(--pn);
	flex: none;
}
.ph0.cp {
	height: 46px;
	box-sizing: border-box;
	padding: 0 16px;
	display: flex;
	align-items: center;
}
.explorer.lg .ph0.cp {
	height: 56px;
}
.ph0.cp.lft {
	padding-left: 10px;
}
.ph0.cp .hrow {
	flex: 1;
	min-width: 0;
}
.ph0.cp .hrow,
.ph0.nt .hrow {
	margin-top: 0;
}
.ph0.cp :deep(.bc) {
	font-size: 13px;
	margin-right: auto;
}
.explorer.lg .ph0.cp :deep(.bc) {
	font-size: 15px;
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
.explorer.lg .ttl {
	font-size: 21px;
}
/* Quiet: shows only when the cloud takes a moment to answer, so a quick check does not flash.
   It sits by the title: the free space moves from the title to it */
.ttl:has(+ .rfm),
.ph0.cp .hrow > :deep(.bc):has(+ .rfm) {
	margin-right: 0;
}
.rfm {
	flex: none;
	margin: 0 auto 0 6px;
	font-size: 14px;
	color: var(--text-muted);
	opacity: 0;
	animation: rfm-in 160ms ease-out 400ms forwards, rfm-spin 0.9s linear infinite;
}
@keyframes rfm-in {
	to { opacity: 0.7; }
}
@keyframes rfm-spin {
	to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
	.rfm { animation: rfm-in 160ms ease-out 400ms forwards; }
}
</style>

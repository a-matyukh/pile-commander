<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { FolderCrumb } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import HomeGlyph from '@/ui/explorer/HomeGlyph.vue'
import { navigate_public } from '@/services/navigatePublic'

/**
 * The parents of the open folder; a click opens that parent. Above the title,
 * or with `title` one line ending in the open folder (compact header, path
 * in the top bar)
 */
defineProps<{ crumbs: FolderCrumb[]; title?: string }>()

/**
 * A folder opens; the cloud itself opens as a page of its top-level folders.
 * A publication's path starts at the Hub and its author's profile
 */
function open(crumb: FolderCrumb) {
	if (crumb.ref) void explorer_navigation.open_folder(crumb.ref)
	else if (crumb.glyph === 'cloud') void explorer_navigation.open_page('cloud')
	else if (crumb.glyph === 'hub') void explorer_navigation.open_page('hub')
	else if (crumb.glyph === 'author') navigate_public(`/${crumb.name}`)
}

const clickable = (crumb: FolderCrumb) => !!crumb.ref || crumb.glyph === 'cloud' || crumb.glyph === 'hub' || crumb.glyph === 'author'
/** Shown as an icon only: its name goes to the tooltip */
const icon_only = (crumb: FolderCrumb) => crumb.glyph === 'home' || crumb.glyph === 'cloud' || crumb.glyph === 'browser'
</script>

<template>
	<div class="bc">
		<template v-for="(crumb, i) in crumbs" :key="crumb.ref?.folder_id ?? `drive:${crumb.name}`">
			<Icon v-if="i > 0" icon="tabler:chevron-right" class="sep" />
			<span
				class="crumb"
				:class="{ static: !clickable(crumb) }"
				:data-tip="icon_only(crumb) ? crumb.name : undefined"
				:aria-label="icon_only(crumb) ? crumb.name : undefined"
				:role="clickable(crumb) ? 'link' : undefined"
				@click="open(crumb)"
			>
				<HomeGlyph v-if="crumb.glyph === 'home'" :size="14" />
				<Icon v-else-if="crumb.glyph === 'cloud'" icon="tabler:cloud" style="font-size: 17px" />
				<Icon v-else-if="crumb.glyph === 'browser'" icon="tabler:database" style="font-size: 14px" />
				<template v-else-if="crumb.glyph === 'hub'"><Icon icon="tabler:world" style="font-size: 14px" />{{ crumb.name }}</template>
				<template v-else>{{ crumb.name }}</template>
			</span>
		</template>
		<template v-if="title !== undefined">
			<Icon v-if="crumbs.length" icon="tabler:chevron-right" class="sep" />
			<span class="cur">{{ title }}</span>
		</template>
	</div>
</template>

<style scoped>
.bc {
	display: flex;
	align-items: center;
	gap: 4px;
	font-size: 12px;
	line-height: 18px;
	color: var(--text-muted);
	min-height: 18px;
	min-width: 0;
	white-space: nowrap;
	overflow: hidden;
}
.sep {
	font-size: 12px;
}
.crumb {
	cursor: pointer;
	display: flex;
	align-items: center;
	gap: 4px;
	height: 18px;
}
.cur {
	color: var(--text-primary);
	font-weight: 500;
	overflow: hidden;
	text-overflow: ellipsis;
}
.crumb.static {
	cursor: default;
}
.explorer.lg .bc {
	font-size: 14px;
	line-height: 22px;
}
.explorer.lg .crumb {
	height: 22px;
}
@media (hover: hover) {
	.crumb:not(.static):hover {
		color: var(--text-primary);
	}
}
</style>

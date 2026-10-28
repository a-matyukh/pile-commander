<script setup lang="ts">
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { FolderCrumb } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import HomeGlyph from '@/ui/explorer/HomeGlyph.vue'

/** The parents of the open folder, above its title. A click opens that parent */
defineProps<{ crumbs: FolderCrumb[] }>()

function open(ref: FolderRef | null) {
	if (ref) void explorer_navigation.open_folder(ref)
}
</script>

<template>
	<div class="bc">
		<template v-for="(crumb, i) in crumbs" :key="crumb.ref?.folder_id ?? `drive:${crumb.name}`">
			<Icon v-if="i > 0" icon="tabler:chevron-right" class="sep" />
			<span
				class="crumb"
				:class="{ static: !crumb.ref }"
				:data-tip="crumb.glyph ? crumb.name : undefined"
				:aria-label="crumb.glyph ? crumb.name : undefined"
				:role="crumb.ref ? 'link' : undefined"
				@click="open(crumb.ref)"
			>
				<HomeGlyph v-if="crumb.glyph === 'home'" :size="14" />
				<Icon v-else-if="crumb.glyph === 'cloud'" icon="tabler:cloud" style="font-size: 17px" />
				<Icon v-else-if="crumb.glyph === 'browser'" icon="tabler:database" style="font-size: 14px" />
				<template v-else>{{ crumb.name }}</template>
			</span>
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
.crumb.static {
	cursor: default;
}
:global(.explorer.lg) .bc {
	font-size: 14px;
	line-height: 22px;
}
:global(.explorer.lg) .crumb {
	height: 22px;
}
@media (hover: hover) {
	.crumb:not(.static):hover {
		color: var(--text-primary);
	}
}
</style>

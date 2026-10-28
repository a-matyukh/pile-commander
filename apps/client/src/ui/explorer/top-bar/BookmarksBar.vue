<script setup lang="ts">
import { ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import {
	bookmark_name,
	explorer_bookmarks,
	folder_ref_key,
	move_bookmark,
} from '@/store/explorer/bookmarks'
import { explorer_navigation } from '@/store/explorer/navigation'
import IconButton from '@/ui/kit/IconButton.vue'
import { use_pointer_reorder } from '@/ui/kit/use_pointer_reorder'
import { bookmark_added_title, bookmark_current_folder } from './bookmark_current'

const toast = useToast()
const bar = ref<HTMLElement | null>(null)

use_pointer_reorder({ container: bar, item: '.bk', axis: 'x', on_move: move_bookmark })

function is_current(key: string): boolean {
	const location = explorer_navigation.location
	if (!location || location.kind !== 'folder') return false
	return folder_ref_key(location.ref) === key
}

function add_current() {
	const name = bookmark_current_folder()
	if (name) toast.add({ title: bookmark_added_title(name) })
}
</script>

<template>
	<IconButton
		icon="tabler:bookmark-plus"
		:aria-label="t('bookmarks.add_current')"
		:data-tip="t('bookmarks.add_current')"
		@click="add_current"
	/>
	<div ref="bar" class="bks">
		<div
			v-for="bookmark in explorer_bookmarks"
			:key="folder_ref_key(bookmark)"
			class="bk"
			:class="{ on: is_current(folder_ref_key(bookmark)) }"
			:data-key="folder_ref_key(bookmark)"
			:data-tip="t('bookmarks.drag_hint')"
			@click="explorer_navigation.open_bookmark(bookmark)"
		>
			<Icon icon="tabler:folder" />
			{{ bookmark_name(bookmark) }}
		</div>
	</div>
</template>

<style scoped>
.bks {
	display: flex;
	align-items: center;
	gap: 2px;
	min-width: 0;
}
.bk {
	display: flex;
	align-items: center;
	gap: 6px;
	height: 24px;
	padding: 0 8px;
	border-radius: 6px;
	font-size: 12px;
	color: var(--text-primary);
	white-space: nowrap;
	cursor: grab;
	user-select: none;
	-webkit-user-select: none;
	touch-action: none;
	flex: none;
}
.bk.on {
	background: var(--hv);
}
.bk :deep(svg) {
	font-size: 14px;
}
.bk.dragging {
	opacity: .35;
}
.bk.drop-before {
	box-shadow: inset 2px 0 0 var(--fill-accent);
	border-radius: 0 6px 6px 0;
}
.bk.drop-after {
	box-shadow: inset -2px 0 0 var(--fill-accent);
	border-radius: 6px 0 0 6px;
}
.explorer.lg .bk {
	height: 32px;
	font-size: 14px;
	padding: 0 10px;
}
.explorer.lg .bk :deep(svg) {
	font-size: 17px;
}
@media (hover: hover) {
	.bk:hover {
		background: var(--hv);
	}
}
</style>

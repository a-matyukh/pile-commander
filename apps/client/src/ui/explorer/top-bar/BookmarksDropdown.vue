<script setup lang="ts">
import { computed, ref } from 'vue'
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'
import {
	bookmark_name,
	explorer_bookmarks,
	folder_ref_key,
	is_bookmarked,
	move_bookmark,
	remove_bookmark,
} from '@/store/explorer/bookmarks'
import { explorer_navigation } from '@/store/explorer/navigation'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import { use_pointer_reorder } from '@/ui/kit/use_pointer_reorder'
import { bookmark_added_title, bookmark_current_folder } from './bookmark_current'

const toast = useToast()
const open = ref(false)
const list = ref<HTMLElement | null>(null)

const current = computed(() => {
	const location = explorer_navigation.location
	if (!location || location.kind !== 'folder' || !is_bookmarked(location.ref)) return null
	return location.ref
})

use_pointer_reorder({ container: list, item: '.bkm', axis: 'y', on_move: move_bookmark })

function is_current(key: string): boolean {
	return current.value !== null && folder_ref_key(current.value) === key
}

function add_current() {
	const name = bookmark_current_folder()
	if (name) toast.add({ title: bookmark_added_title(name) })
}
</script>

<template>
	<DropMenu v-model:open="open" :width="250" align="start">
		<template #trigger>
			<IconButton class="bmb" :active="open" :aria-label="current ? bookmark_name(current) : t('bookmarks.title')" :data-tip="t('bookmarks.title')">
				<Icon v-if="current" icon="tabler:folder" />
				<Icon v-else icon="tabler:bookmarks" />
				<span class="nm">{{ current ? bookmark_name(current) : t('bookmarks.title') }}</span>
				<Icon icon="tabler:selector" class="sl" />
			</IconButton>
		</template>
		<MenuLabel :label="t('bookmarks.list_title')" />
		<div v-if="explorer_bookmarks.length" ref="list">
			<MenuItem
				v-for="bookmark in explorer_bookmarks"
				:key="folder_ref_key(bookmark)"
				class="bkm"
				:data-key="folder_ref_key(bookmark)"
				:current="is_current(folder_ref_key(bookmark))"
				@select="explorer_navigation.open_bookmark(bookmark)"
			>
				<template #leading>
					<Icon icon="tabler:grip-vertical" class="gp" />
					<Icon icon="tabler:folder" />
				</template>
				{{ bookmark_name(bookmark) }}
				<button
					type="button"
					class="rm"
					:aria-label="t('menu.bookmark_remove')"
					:data-tip="t('menu.bookmark_remove')"
					@pointerdown.stop
					@click.stop.prevent="remove_bookmark(bookmark)"
				>
					<Icon icon="tabler:x" />
				</button>
			</MenuItem>
		</div>
		<MenuLabel v-else :label="t('bookmarks.empty')" />
		<MenuSeparator />
		<MenuItem icon="tabler:bookmark-plus" :label="t('bookmarks.add_current')" @select="add_current" />
	</DropMenu>
</template>

<style scoped>
.bmb {
	max-width: 200px;
}
.nm {
	overflow: hidden;
	text-overflow: ellipsis;
	font-size: 12px;
	color: var(--text-primary);
}
.sl {
	font-size: 14px !important;
	color: var(--text-muted);
}
.explorer.lg .nm {
	font-size: 14px;
}
.bkm.mi {
	cursor: grab;
	user-select: none;
	-webkit-user-select: none;
	touch-action: none;
	padding-left: 4px;
}
.bkm :deep(.lb) {
	flex: 1;
}
.rm {
	margin-left: auto;
	display: flex;
	align-items: center;
	padding: 2px;
	border: 0;
	border-radius: 4px;
	background: none;
	color: var(--text-muted);
	cursor: pointer;
	visibility: hidden;
}
.bkm[data-highlighted] .rm {
	visibility: visible;
}
.rm:hover {
	color: var(--text-primary);
	background: var(--surface-2);
}
.gp {
	font-size: 14px;
	color: var(--text-muted);
}
.bkm.dragging {
	opacity: .35;
}
.bkm.drop-before {
	box-shadow: inset 0 2px 0 var(--fill-accent);
}
.bkm.drop-after {
	box-shadow: inset 0 -2px 0 var(--fill-accent);
}
</style>

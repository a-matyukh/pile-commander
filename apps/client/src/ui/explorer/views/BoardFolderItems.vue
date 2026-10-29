<script setup lang="ts">
import { computed } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { is_desktop } from '@/isDesktop'
import store from '@/store'
import { folder_menu_items, reveal_in_finder, toggle_bookmark } from '@/store/explorer/folder_menu'
import { explorer_navigation } from '@/store/explorer/navigation'
import { explorer_tree } from '@/store/explorer/tree'
import { report_error } from '@/store/helpers/reportError'
import FolderLookItems from '@/ui/explorer/folder-header/FolderLookItems.vue'
import { use_home } from '@/ui/explorer/folder-header/use_folder_place'
import MenuItem from '@/ui/kit/MenuItem.vue'

/**
 * A folder card's own items on a board, as its menu in the tree and the
 * header has them: the bookmark and Finder (`place`), its icon and cover
 * (`look`). The folder sits in the open folder's root
 */
const props = defineProps<{ node_id: string; part: 'place' | 'look' }>()

const folder = computed<FolderRef | null>(() => {
	const location = explorer_navigation.location
	return location?.kind === 'folder' ? { ...location.ref, folder_id: props.node_id } : null
})
const item = computed(() => {
	const ref = folder.value
	return ref ? explorer_tree.roots.find(root => root.drive.id === ref.drive_id && root.root.id === ref.root_id) ?? null : null
})
const home = use_home()
const items = computed(() => folder.value
	? folder_menu_items(folder.value, { item: item.value, can_write: !!item.value?.workspace?.can_write, desktop: is_desktop, home: home.value })
	: null)

function reveal() {
	if (folder.value) reveal_in_finder(folder.value).catch(error => report_error(store, error))
}
</script>

<template>
	<template v-if="folder && items">
		<template v-if="part === 'place'">
			<MenuItem
				:icon="items.bookmarked ? 'tabler:bookmark-off' : 'tabler:bookmark-plus'"
				:label="items.bookmarked ? t('menu.bookmark_remove') : t('menu.bookmark_add')"
				@select="toggle_bookmark(folder)"
			/>
			<MenuItem v-if="items.show_in_finder" icon="tabler:external-link" :label="t('menu.show_in_finder')" @select="reveal" />
		</template>
		<FolderLookItems v-else-if="items.rename && item" :item="item" :folder="folder" />
	</template>
</template>

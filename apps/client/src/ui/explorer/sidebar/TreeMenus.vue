<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import {
	TREE_FILTERS,
	TREE_SORTS,
	explorer_tree_view,
	is_tree_filtered,
	is_tree_sort_changed,
	type TreeFilterKey,
	type TreeSortKey,
} from '@/store/explorer/tree_view'
import DropMenu from '@/ui/kit/DropMenu.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'

/** Filter and sort buttons of the sidebar toolbar; menus open upward */
const filter_open = ref(false)
const sort_open = ref(false)

const filter_keys = Object.keys(TREE_FILTERS) as TreeFilterKey[]
const sort_keys = Object.keys(TREE_SORTS) as TreeSortKey[]
const view = explorer_tree_view
const filtered = computed(() => is_tree_filtered(view.value))
const sort_changed = computed(() => is_tree_sort_changed(view.value))
</script>

<template>
	<DropMenu v-model:open="filter_open" side="top" align="start" :width="230">
		<template #trigger>
			<IconButton
				icon="tabler:filter"
				:active="filter_open"
				:accent="filtered"
				:aria-label="t('tree.filter')"
				:data-tip="t('tree.filter')"
			/>
		</template>
		<MenuLabel :label="t('tree.show')" />
		<template v-for="(key, i) in filter_keys" :key="key">
			<MenuSeparator v-if="i === 1" />
			<MenuItem
				:icon="TREE_FILTERS[key].icon"
				:label="t(`filter.${key}`)"
				:checked="view.filter === key"
				@select="view.filter = key"
			/>
		</template>
	</DropMenu>
	<DropMenu v-model:open="sort_open" side="top" align="start" :width="230">
		<template #trigger>
			<IconButton
				icon="tabler:arrows-sort"
				:active="sort_open"
				:accent="sort_changed"
				:aria-label="t('tree.sort')"
				:data-tip="t('tree.sort')"
			/>
		</template>
		<MenuLabel :label="t('tree.sort')" />
		<MenuItem
			v-for="key in sort_keys"
			:key="key"
			:icon="TREE_SORTS[key].icon"
			:label="t(`sort.${key}`)"
			:checked="view.sort === key"
			keep_open
			@select="view.sort = key"
		/>
		<MenuSeparator />
		<MenuItem
			icon="tabler:arrow-up"
			:label="t('sort.asc')"
			:checked="view.direction === 'asc'"
			keep_open
			@select="view.direction = 'asc'"
		/>
		<MenuItem
			icon="tabler:arrow-down"
			:label="t('sort.desc')"
			:checked="view.direction === 'desc'"
			keep_open
			@select="view.direction = 'desc'"
		/>
	</DropMenu>
</template>

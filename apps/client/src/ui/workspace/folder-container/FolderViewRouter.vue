<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { FolderView } from '@/domain/Widget'
import List from './list/List.vue'
import Grid from './grid/Grid.vue'
import Stack from './stack/Stack.vue'
import FolderViewLoading from './FolderViewLoading.vue'
import FolderViewScope from './FolderViewScope.vue'
import { useFolderContainerScope } from './useFolderContainerScope'

const asyncViewOptions = {
	loadingComponent: FolderViewLoading,
	delay: 0,
}

const Board = defineAsyncComponent({
	loader: () => import('./board/Board.vue'),
	...asyncViewOptions,
})
const Canvas = defineAsyncComponent({
	loader: () => import('./canvas/Canvas.vue'),
	...asyncViewOptions,
})
const Slides = defineAsyncComponent({
	loader: () => import('./slides/Slides.vue'),
	...asyncViewOptions,
})
const Masonry = defineAsyncComponent({
	loader: () => import('./masonry/Masonry.vue'),
	...asyncViewOptions,
})
const Dashboard = defineAsyncComponent({
	loader: () => import('./dashboard/Dashboard.vue'),
	...asyncViewOptions,
})

defineProps<{
	view: FolderView
}>()

// Every folder gets a view of its own: the key on FolderViewScope. One kept
// for the next folder showed it with the previous folder's zoom and scroll,
// and its board or canvas was still registered under the folder that was left
const { folderId } = useFolderContainerScope()
</script>

<template>
	<FolderViewScope :key="folderId">
		<List v-if="view === 'list'" />
		<Grid v-else-if="view === 'grid'" />
		<Board v-else-if="view === 'board'" />
		<Canvas v-else-if="view === 'canvas'" />
		<Stack v-else-if="view === 'stack'" />
		<Slides v-else-if="view === 'slides'" />
		<Masonry v-else-if="view === 'masonry'" />
		<Dashboard v-else-if="view === 'dashboard'" />
	</FolderViewScope>
</template>

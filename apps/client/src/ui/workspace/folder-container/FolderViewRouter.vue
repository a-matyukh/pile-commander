<script setup lang="ts">
import { defineAsyncComponent } from 'vue'
import type { FolderView } from '@/domain/Widget'
import List from './list/List.vue'
import Grid from './grid/Grid.vue'
import Stack from './stack/Stack.vue'
import FolderViewLoading from './FolderViewLoading.vue'

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

defineProps<{
	view: FolderView
}>()
</script>

<template>
	<List v-if="view === 'list'" />
	<Grid v-else-if="view === 'grid'" />
	<Board v-else-if="view === 'board'" />
	<Canvas v-else-if="view === 'canvas'" />
	<Stack v-else-if="view === 'stack'" />
	<Slides v-else-if="view === 'slides'" />
	<Masonry v-else-if="view === 'masonry'" />
</template>

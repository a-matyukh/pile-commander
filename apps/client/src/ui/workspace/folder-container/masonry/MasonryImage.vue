<script setup lang="ts">
import { ref } from 'vue'
import { useMediaSrc } from '../media/useMediaSrc'

const props = defineProps<{
	fileId: string
	filename: string
}>()

const { src, error } = useMediaSrc(() => props.fileId, () => props.filename)
/** 4:3 until the file reports its own size. */
const ratio = ref('4 / 3')

function onLoad(event: Event) {
	const img = event.target
	if (!(img instanceof HTMLImageElement)) return
	if (img.naturalWidth > 0 && img.naturalHeight > 0) {
		ratio.value = `${img.naturalWidth} / ${img.naturalHeight}`
	}
}
</script>

<template>
	<div class="masonry-image" :style="{ aspectRatio: ratio }">
		<img
			v-if="src && !error"
			:src="src"
			:alt="filename"
			draggable="false"
			@load="onLoad"
		>
	</div>
</template>

<style scoped>
.masonry-image {
	width: 100%;
	background: var(--ui-bg-muted, #f3f4f6);
	overflow: hidden;
}

.masonry-image img {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: cover;
}
</style>

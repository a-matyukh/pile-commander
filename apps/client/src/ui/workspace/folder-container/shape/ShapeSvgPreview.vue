<script setup lang="ts">
import { useShapeContent } from './useShapeContent'

const props = defineProps<{
	fileId: string
}>()

const { svgHtml, loading } = useShapeContent(() => props.fileId)
</script>

<template>
	<div class="shape-svg-preview">
		<div v-if="loading" class="shape-svg-loading text-muted text-sm">…</div>
		<div v-else-if="svgHtml" class="shape-svg-inner" v-html="svgHtml" />
	</div>
</template>

<style scoped>
.shape-svg-preview {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: visible;
}

.shape-svg-inner {
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
}

.shape-svg-inner :deep(svg) {
	display: block;
	width: 100%;
	height: 100%;
}
</style>

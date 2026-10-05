<script setup lang="ts">
import { defineAsyncComponent, onMounted, onUnmounted, ref } from 'vue'
import type { FolderContainerWidget } from '@/domain/Widget'

const FolderPreview = defineAsyncComponent(() => import('../FolderPreview.vue'))

defineProps<{
	container: FolderContainerWidget
}>()

const root = ref<HTMLElement | null>(null)
const visible = ref(false)
let observer: IntersectionObserver | null = null

onMounted(() => {
	if (!root.value) {
		visible.value = true
		return
	}

	observer = new IntersectionObserver(
		([entry]) => {
			if (entry?.isIntersecting) {
				visible.value = true
				observer?.disconnect()
				observer = null
			}
		},
		{ rootMargin: '120px' },
	)
	observer.observe(root.value)
})

onUnmounted(() => {
	observer?.disconnect()
	observer = null
})
</script>

<template>
	<div ref="root" class="lazy-folder-preview">
		<FolderPreview
			v-if="visible"
			:container="container"
		/>
		<div
			v-else
			class="lazy-folder-preview-placeholder"
			aria-hidden="true"
		/>
	</div>
</template>

<style scoped>
.lazy-folder-preview {
	width: 100%;
	height: 100%;
	min-height: inherit;
}

.lazy-folder-preview-placeholder {
	width: 100%;
	height: 100%;
	min-height: inherit;
	background: color-mix(in oklab, var(--pc-bg-muted) 80%, transparent);
}
</style>

<script setup lang="ts">
import { computed } from 'vue'
import { resolve_slide_index } from './slidesUtils'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

defineProps<{
	compact?: boolean
}>()

const scope = useFolderContainerScope()
const workspace = useWorkspace()

const currentIndex = computed(() =>
	scope.container.value ? resolve_slide_index(scope.container.value) : 0,
)
const total = computed(() => scope.container.value?.children.length ?? 0)

const canGoPrev = computed(() => currentIndex.value > 0)
const canGoNext = computed(() => total.value > 0 && currentIndex.value < total.value - 1)

function goTo(index: number) {
	if (workspace.value?.can_write === false) return
	workspace.value?.change_selected_slide_index(scope.folderId.value, index)
}

function goPrev() {
	if (canGoPrev.value) {
		goTo(currentIndex.value - 1)
	}
}

function goNext() {
	if (canGoNext.value) {
		goTo(currentIndex.value + 1)
	}
}
</script>

<template>
	<div v-if="total > 0" class="slide-switcher">
		<UButton
			icon="i-lucide-chevron-left"
			color="neutral"
			variant="ghost"
			:size="compact ? 'xs' : 'sm'"
			:disabled="!canGoPrev"
			@click="goPrev"
		/>
		<span class="slide-counter">{{ currentIndex + 1 }} / {{ total }}</span>
		<UButton
			icon="i-lucide-chevron-right"
			color="neutral"
			variant="ghost"
			:size="compact ? 'xs' : 'sm'"
			:disabled="!canGoNext"
			@click="goNext"
		/>
	</div>
</template>

<style scoped>
.slide-switcher {
	display: flex;
	align-items: center;
	gap: 0.25rem;
}

.slide-counter {
	min-width: 3.5rem;
	text-align: center;
	font-size: 0.75rem;
	color: var(--pc-text-muted);
	user-select: none;
}
</style>

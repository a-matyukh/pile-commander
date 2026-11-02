<script setup lang="ts">
import { computed } from 'vue'
import { resolve_slide_index, set_local_slide_index, viewer_slide_scope } from './slidesUtils'
import { useFolderContainerScope } from '../useFolderContainerScope'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import IconButton from '@/ui/kit/IconButton.vue'

const scope = useFolderContainerScope()
const workspace = useWorkspace()

const slideScope = computed(() => viewer_slide_scope(workspace.value, scope.folderId.value))

const currentIndex = computed(() =>
	resolve_slide_index(scope.container.value, slideScope.value),
)
const total = computed(() => scope.container.value?.children.length ?? 0)

const canGoPrev = computed(() => currentIndex.value > 0)
const canGoNext = computed(() => total.value > 0 && currentIndex.value < total.value - 1)

function goTo(index: number) {
	const ws = workspace.value
	if (!ws) return
	if (ws.can_write === false) {
		set_local_slide_index(ws.uid, scope.folderId.value, index)
		return
	}
	void ws.change_selected_slide_index(scope.folderId.value, index)
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
	<div v-if="total > 0" class="slide-switcher ex">
		<IconButton icon="tabler:chevron-left" :disabled="!canGoPrev" @click="canGoPrev && goPrev()" />
		<span class="slide-counter">{{ currentIndex + 1 }} / {{ total }}</span>
		<IconButton icon="tabler:chevron-right" :disabled="!canGoNext" @click="canGoNext && goNext()" />
	</div>
</template>

<style scoped>
.slide-switcher {
	display: flex;
	align-items: center;
	gap: 0.25rem;
}

.slide-switcher.ex .slide-counter {
	color: var(--text-muted);
	font-variant-numeric: tabular-nums;
}

.slide-counter {
	min-width: 3.5rem;
	text-align: center;
	font-size: 0.75rem;
	color: var(--pc-text-muted);
	user-select: none;
}
</style>

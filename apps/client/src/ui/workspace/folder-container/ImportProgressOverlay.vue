<script setup lang="ts">
import { computed } from 'vue'
import type { ImportProgress } from '@/domain/Store'

const props = defineProps<{
	progress: ImportProgress | null
}>()

const percent = computed(() => {
	const progress = props.progress
	if (!progress || progress.total_bytes === 0) return 0
	return Math.round((progress.loaded_bytes / progress.total_bytes) * 100)
})
</script>

<template>
	<div
		v-if="progress"
		class="absolute bottom-4 right-4 z-50 w-72 rounded-lg border border-default bg-default p-3 shadow-lg"
		role="status"
		aria-live="polite"
	>
		<div class="mb-1.5 flex items-center justify-between gap-2 text-xs">
			<span class="min-w-0 truncate font-medium text-default">
				{{ progress.file_name }}
			</span>
			<span class="shrink-0 text-muted">
				{{ progress.file_index }} of {{ progress.total_files }} · {{ percent }}%
			</span>
		</div>
		<UProgress
			:model-value="progress.loaded_bytes"
			:max="progress.total_bytes"
		/>
	</div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { ImportProgress } from '@/domain/Store'
import { t } from '@/i18n'

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
		class="overlay"
		role="status"
		aria-live="polite"
	>
		<div class="row">
			<span class="name">{{ progress.file_name }}</span>
			<span class="meta">{{ t('importing.count', { done: progress.file_index, total: progress.total_files }) }} · {{ percent }}%</span>
		</div>
		<div class="track">
			<div class="fill" :style="{ width: percent + '%' }" />
		</div>
	</div>
</template>

<style scoped>
.overlay {
	position: absolute;
	right: 16px;
	bottom: 16px;
	z-index: 50;
	width: 18rem;
	padding: 12px;
	border-radius: 8px;
	border: 1px solid var(--border, rgba(0, 0, 0, .08));
	background: var(--surface-2, #fff);
	color: var(--text-primary, inherit);
	box-shadow: 0 2px 10px rgba(0, 0, 0, .15);
}
.row {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
	margin-bottom: 6px;
	font-size: 12px;
}
.name {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	font-weight: 500;
}
.meta {
	flex: none;
	color: var(--text-muted, #9A9893);
}
.track {
	height: 4px;
	border-radius: 999px;
	background: var(--border-strong, rgba(0, 0, 0, .15));
	overflow: hidden;
}
.fill {
	height: 100%;
	background: var(--fill-accent, #378ADD);
}
</style>

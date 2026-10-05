<script setup lang="ts">
defineProps<{
	label?: string
}>()
</script>

<!-- Trailing of the View submenu trigger: current view + chevron (kbds are hidden when children exist). -->
<template>
	<span class="flex items-center gap-2">
		<span class="text-sm text-muted">{{ label }}</span>
		<UIcon name="i-lucide-chevron-right" class="size-4 shrink-0 text-dimmed" />
	</span>
</template>

<script setup lang="ts">
defineProps<{
	rectStyle: Record<string, string> | null
}>()
</script>

<template>
	<div
		v-if="rectStyle"
		class="board-marquee"
		:style="rectStyle"
		aria-hidden="true"
	/>
</template>

<style scoped>
.board-marquee {
	position: absolute;
	z-index: 10000;
	pointer-events: none;
	box-sizing: border-box;
	border: 1px dashed #3b82f6;
	background: rgba(59, 130, 246, 0.15);
}
</style>

<script setup lang="ts">
defineProps<{
	/** Null runs the bar across. A number from 0 to 1 fills that share. */
	fraction: number | null
}>()
</script>

<template>
	<div class="track" aria-hidden="true">
		<div v-if="fraction === null" class="fill slide" />
		<div v-else class="fill" :style="{ width: `${fraction * 100}%` }" />
	</div>
</template>

<style scoped>
.track {
	height: 4px;
	margin-top: 10px;
	border-radius: 999px;
	background: var(--border);
	overflow: hidden;
}
.fill {
	height: 100%;
	border-radius: inherit;
	background: var(--accent, currentColor);
}
.fill.slide {
	width: 40%;
	animation: panel-slide 1.1s ease-in-out infinite;
}
@keyframes panel-slide {
	0% { transform: translateX(-120%); }
	100% { transform: translateX(280%); }
}
</style>

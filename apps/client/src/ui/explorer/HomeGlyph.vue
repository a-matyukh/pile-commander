<script setup lang="ts">
defineProps<{ size: number }>()
</script>

<template>
	<span class="hm" :style="{ fontSize: size + 'px' }">~</span>
</template>

<style scoped>
.hm {
	text-align: center;
	font-family: var(--font-mono);
	line-height: 1;
	flex: none;
	display: inline-flex;
	align-items: center;
}
</style>

<script setup lang="ts">
defineProps<{
	color?: string
}>()
</script>

<!-- Leading swatch for color preset menu items. -->
<template>
	<span
		v-if="color"
		class="size-3 shrink-0 rounded-full ring ring-default"
		:class="{ 'bg-checker': color === 'transparent' }"
		:style="color === 'transparent' ? undefined : { backgroundColor: color }"
	/>
</template>

<style scoped>
.bg-checker {
	background-color: #fff;
	background-image:
		linear-gradient(45deg, #d4d4d8 25%, transparent 25%),
		linear-gradient(-45deg, #d4d4d8 25%, transparent 25%),
		linear-gradient(45deg, transparent 75%, #d4d4d8 75%),
		linear-gradient(-45deg, transparent 75%, #d4d4d8 75%);
	background-size: 6px 6px;
	background-position:
		0 0,
		0 3px,
		3px -3px,
		-3px 0;
}
</style>

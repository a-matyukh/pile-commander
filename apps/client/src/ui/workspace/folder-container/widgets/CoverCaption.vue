<script setup lang="ts">
defineProps<{ name: string }>()
</script>

<template>
	<span class="cap" :title="name">{{ name }}</span>
</template>

<style scoped>
/* The picture is the card. Its name sits on a dark strip along the bottom. */
.cap {
	position: absolute;
	z-index: 1;
	left: 0;
	right: 0;
	bottom: 0;
	padding: 22px 8px 7px;
	background: linear-gradient(to top, rgb(0 0 0 / .62), rgb(0 0 0 / 0));
	color: white;
	text-align: center;
	font-size: 12px;
	line-height: 1.3;
	overflow: hidden;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	line-clamp: 2;
	overflow-wrap: anywhere;
	pointer-events: none;
}
:global(.explorer.lg) .cap {
	font-size: 14px;
}
</style>

<script setup lang="ts">
import { t } from '@/i18n'

/**
 * What a cloud folder shows while it opens: grey tiles where its items will
 * be, at once, so the click answers before the network does (the header
 * already names the folder). Replaced by the folder as soon as it has opened.
 */
const TILES = 8
</script>

<template>
	<div class="fph" role="status" aria-busy="true" :aria-label="t('folder.opening')">
		<div v-for="n in TILES" :key="n" class="tile" :style="{ animationDelay: `${(n % 4) * 90}ms` }">
			<div class="pic" />
			<div class="line" />
		</div>
	</div>
</template>

<style scoped>
.fph {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
	gap: 16px;
	padding: 16px;
	align-content: start;
}
.tile {
	display: flex;
	flex-direction: column;
	gap: 8px;
	animation: fph-pulse 1.4s ease-in-out infinite;
}
.pic {
	aspect-ratio: 4 / 3;
	border-radius: 10px;
	background: var(--surface-0);
	border: 0.5px solid var(--border);
}
.line {
	width: 60%;
	height: 10px;
	border-radius: 5px;
	background: var(--surface-0);
	align-self: center;
}
@keyframes fph-pulse {
	0%, 100% { opacity: 1; }
	50% { opacity: .55; }
}
@media (prefers-reduced-motion: reduce) {
	.tile { animation: none; }
}
</style>

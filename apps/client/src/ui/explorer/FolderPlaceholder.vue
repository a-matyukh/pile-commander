<script setup lang="ts">
import { Icon } from '@iconify/vue'
import { t } from '@/i18n'

/**
 * What a cloud folder shows while it opens: a spinner and "Opening the
 * folder…" in the middle of the content, so the click answers before the
 * network does (the header already names the folder). It fades in after a
 * moment, so a quick open does not flash it. Replaced by the folder as soon
 * as it has opened.
 */
</script>

<template>
	<div class="fph" role="status" aria-busy="true">
		<Icon icon="tabler:loader-2" class="spin" aria-hidden="true" />
		<p>{{ t('folder.opening') }}</p>
	</div>
</template>

<style scoped>
.fph {
	height: 100%;
	min-height: 160px;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 10px;
	color: var(--text-muted);
	font-size: 13px;
	opacity: 0;
	animation: fph-in 160ms ease-out 140ms forwards;
}
.fph p {
	margin: 0;
}
.spin {
	font-size: 22px;
	animation: fph-spin 0.8s linear infinite;
}
@keyframes fph-in {
	to { opacity: 1; }
}
@keyframes fph-spin {
	to { transform: rotate(360deg); }
}
@media (prefers-reduced-motion: reduce) {
	.spin { animation: none; }
}
</style>

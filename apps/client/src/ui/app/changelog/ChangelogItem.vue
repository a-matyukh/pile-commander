<script setup lang="ts">
import { computed } from 'vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { locale } from '@/i18n'
import { paragraphs, type ChangelogEntry } from '@/services/changelog'
import { explorer_settings, motion_3d_enabled } from '@/store/explorer/settings'

/** One change: its title, text and pictures or videos, in the interface's language */
const props = defineProps<{ entry: ChangelogEntry }>()

const reduced = usePreferredReducedMotion()
/** Videos play by themselves only when the app's motion is on; otherwise they wait for a click */
const autoplay = computed(() => motion_3d_enabled(explorer_settings.motion_3d, reduced.value === 'reduce'))

const title = computed(() => props.entry.title[locale.value])
const text = computed(() => (props.entry.text ? paragraphs(props.entry.text[locale.value]) : []))
</script>

<template>
	<article class="item">
		<h3 class="title">{{ title }}</h3>
		<p v-for="(p, i) in text" :key="i" class="p">{{ p }}</p>
		<template v-for="m in entry.media" :key="m.src">
			<video
				v-if="m.kind === 'video'"
				class="media"
				:src="m.src"
				:aria-label="m.alt?.[locale]"
				:autoplay="autoplay"
				:controls="!autoplay"
				muted
				loop
				playsinline
				preload="metadata"
			/>
			<img v-else class="media" :src="m.src" :alt="m.alt?.[locale] ?? ''" loading="lazy" decoding="async">
		</template>
	</article>
</template>

<style scoped>
.item {
	display: flex;
	flex-direction: column;
	gap: 6px;
	min-width: 0;
}
.title {
	margin: 0;
	font-size: 13px;
	font-weight: 500;
	color: var(--text-primary);
}
.p {
	margin: 0;
	font-size: 12px;
	line-height: 1.55;
	color: var(--text-secondary);
	white-space: pre-line;
}
.media {
	display: block;
	width: 100%;
	height: auto;
	margin-top: 4px;
	border: 0.5px solid var(--border);
	border-radius: 8px;
	background: var(--surface-1, transparent);
}
.explorer.lg .title {
	font-size: 15px;
}
.explorer.lg .p {
	font-size: 14px;
}
</style>

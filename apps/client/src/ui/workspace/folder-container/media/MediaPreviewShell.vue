<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Icon } from '@iconify/vue'
import { useMediaSrc } from './useMediaSrc'
import MediaPreviewTitle from './MediaPreviewTitle.vue'
import { preview_element, show_play_badge } from './previewElement'
import { media_unavailable_label } from '@/services/board/mediaUnavailable'

const props = defineProps<{
	kind: 'image' | 'video' | 'audio'
	fileId: string
	filename: string
}>()

const { src, loading, error, unavailable, variant } = useMediaSrc(
	() => props.fileId,
	() => props.filename,
)

const element = computed(() => preview_element(props.kind, variant.value))
const playBadge = computed(() => show_play_badge(props.kind, variant.value))
const rootClass = computed(() => `media-${props.kind}-preview`)
const showTitle = computed(() => props.kind === 'video' || props.kind === 'audio')

/**
 * The picture's bytes are still on their way (the address is known, the
 * image is not drawn yet): the loader stays until it is, so an empty card
 * never looks like a missing picture
 */
const drawn = ref(false)
watch(src, () => { drawn.value = false })
const waiting = computed(() =>
	loading.value || (!error.value && !!src.value && element.value !== 'audio' && !drawn.value))
</script>

<template>
	<div class="media-preview" :class="rootClass">
		<MediaPreviewTitle
			v-if="showTitle"
			:filename="filename"
			handle-class="dashboard-drag-handle"
		/>
		<div class="media-preview-body" :class="{ 'board-no-drag': showTitle }">
			<div v-if="waiting" class="media-preview-loading" role="status" :aria-label="filename">
				<Icon icon="tabler:loader-2" class="media-preview-spin" />
			</div>
			<div v-if="!loading && (error || !src)" class="media-preview-unavailable text-muted text-sm">
				{{ media_unavailable_label(unavailable) }}
			</div>
			<img
				v-else-if="!loading && element === 'img'"
				:src="src"
				:alt="filename"
				class="media-preview-media"
				:class="{ 'is-waiting': !drawn }"
				draggable="false"
				@load="drawn = true"
				@error="drawn = true"
			>
			<video
				v-else-if="!loading && element === 'video'"
				:src="src"
				controls
				class="media-preview-media"
				:class="{ 'is-waiting': !drawn }"
				@loadeddata="drawn = true"
				@error="drawn = true"
				@mousedown.stop
			/>
			<audio
				v-else-if="!loading"
				:src="src"
				controls
				class="media-preview-audio"
				@mousedown.stop
			/>
			<span
				v-if="playBadge && !waiting && !error && src"
				class="media-preview-play"
				aria-hidden="true"
			/>
		</div>
	</div>
</template>

<style scoped>
.media-preview {
	position: relative;
	width: 100%;
	height: 100%;
	min-width: 0;
	min-height: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
}

@media (hover: hover) and (pointer: fine) {
	.media-preview:hover :deep(.media-preview-title) {
		opacity: 1;
		pointer-events: auto;
	}
}

.media-preview-body {
	position: relative;
	flex: 1;
	min-height: 0;
	min-width: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	overflow: hidden;
}

/* a visitor's video poster: marks the still as a video; not a control */
.media-preview-play {
	position: absolute;
	top: 50%;
	left: 50%;
	width: 3rem;
	height: 3rem;
	transform: translate(-50%, -50%);
	border-radius: 9999px;
	background: rgb(0 0 0 / 0.55);
	pointer-events: none;
}

.media-preview-play::after {
	content: '';
	position: absolute;
	top: 50%;
	left: 55%;
	transform: translate(-50%, -50%);
	border-style: solid;
	border-width: 0.6rem 0 0.6rem 1rem;
	border-color: transparent transparent transparent #fff;
}

.media-audio-preview .media-preview-body {
	padding: 0.5rem;
}

.media-preview-unavailable {
	padding: 0.5rem;
	text-align: center;
}

/* Over the card while the picture loads. It fades in a moment later, so a
   picture already in the browser's cache does not flash it */
.media-preview-loading {
	position: absolute;
	inset: 0;
	z-index: 1;
	display: flex;
	align-items: center;
	justify-content: center;
	pointer-events: none;
	background: color-mix(in srgb, var(--surface-1, #f2f1ee) 70%, transparent);
	opacity: 0;
	animation: media-loader-in 160ms ease-out 180ms forwards;
}

.media-preview-spin {
	width: 30px;
	height: 30px;
	color: var(--text-primary, #2b2b2b);
	opacity: 0.7;
	animation: media-loader-spin 0.9s linear infinite;
}

.media-preview-media.is-waiting {
	visibility: hidden;
}

@keyframes media-loader-in {
	to { opacity: 1; }
}

@keyframes media-loader-spin {
	to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
	.media-preview-spin {
		animation-duration: 2.4s;
	}
}

.media-preview-media {
	display: block;
	width: 100%;
	height: 100%;
	object-fit: contain;
}

.media-preview-audio {
	display: block;
	width: 100%;
}

.media-video-preview .media-preview-media {
	background: #000;
}
</style>

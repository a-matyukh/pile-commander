<script setup lang="ts">
import { computed } from 'vue'
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
</script>

<template>
	<div class="media-preview" :class="rootClass">
		<MediaPreviewTitle
			v-if="showTitle"
			:filename="filename"
			handle-class="masonry-drag-handle"
		/>
		<div class="media-preview-body" :class="{ 'board-no-drag': showTitle }">
			<div v-if="loading" class="media-preview-loading text-muted text-sm">…</div>
			<div v-else-if="error || !src" class="media-preview-unavailable text-muted text-sm">
				{{ media_unavailable_label(unavailable) }}
			</div>
			<img
				v-else-if="element === 'img'"
				:src="src"
				:alt="filename"
				class="media-preview-media"
				draggable="false"
			>
			<video
				v-else-if="element === 'video'"
				:src="src"
				controls
				class="media-preview-media"
				@mousedown.stop
			/>
			<audio
				v-else
				:src="src"
				controls
				class="media-preview-audio"
				@mousedown.stop
			/>
			<span
				v-if="playBadge && !loading && !error && src"
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

.media-preview-loading,
.media-preview-unavailable {
	padding: 0.5rem;
	text-align: center;
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

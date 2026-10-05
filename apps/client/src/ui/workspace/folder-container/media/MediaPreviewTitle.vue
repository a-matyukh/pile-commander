<script setup lang="ts">
import { MEDIA_TITLE_FILL, MEDIA_TITLE_LINE, MEDIA_TITLE_TEXT } from './mediaChrome'

defineProps<{
	filename: string
	/** Extra classes for layout-specific drag handles (e.g. masonry). */
	handleClass?: string
}>()
</script>

<template>
	<p
		class="media-preview-title"
		:class="handleClass"
	>
		<span class="media-preview-title-label">{{ filename }}</span>
	</p>
</template>

<style scoped>
.media-preview-title {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	z-index: 2;
	display: flex;
	align-items: center;
	margin: 0;
	padding: 0.4rem 0.75rem;
	box-sizing: border-box;
	width: 100%;
	min-height: 36px;
	font-size: 13px;
	line-height: 1.2;
	color: v-bind('MEDIA_TITLE_TEXT');
	user-select: none;
	cursor: grab;
	border-bottom: 1px solid v-bind('MEDIA_TITLE_LINE');
	background: v-bind('MEDIA_TITLE_FILL');
	backdrop-filter: blur(8px);
	-webkit-backdrop-filter: blur(8px);
}

.media-preview-title:active {
	cursor: grabbing;
}

.media-preview-title-label {
	min-width: 0;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* Desktop / fine pointer: show title only while the preview is hovered. */
@media (hover: hover) and (pointer: fine) {
	.media-preview-title {
		opacity: 0;
		pointer-events: none;
		transition: opacity 0.15s ease;
	}
}
</style>

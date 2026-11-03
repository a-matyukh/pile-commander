<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { contained_image_box } from '@/services/workspace/imageText'

const props = defineProps<{
	/** outside: board and canvas, text hangs off the sized picture. stack: fills a cell. grow: the card grows. */
	mode: 'outside' | 'stack' | 'grow'
	title?: string
	description?: string
}>()

const hanging = computed(() =>
	props.mode === 'outside' && Boolean(props.title || props.description),
)

const pictureEl = ref<HTMLElement | null>(null)
/** Painted image edges inside the picture box, so the text sits on the picture, not the card. */
const painted = ref<{ top: number; left: number; width: number; height: number } | null>(null)

const titleStyle = computed(() => {
	const box = painted.value
	if (!box || props.mode !== 'outside') return undefined
	return {
		top: `${box.top}px`,
		left: `${box.left}px`,
		width: `${box.width}px`,
		right: 'auto',
	}
})

const captionStyle = computed(() => {
	const box = painted.value
	if (!box || props.mode !== 'outside') return undefined
	return {
		top: `${box.top + box.height}px`,
		left: `${box.left}px`,
		width: `${box.width}px`,
		right: 'auto',
	}
})

function layoutText() {
	const picture = pictureEl.value
	if (!picture || props.mode !== 'outside') return
	const img = picture.querySelector('img')
	if (!(img instanceof HTMLImageElement)) return
	const imgBox = img.getBoundingClientRect()
	const pictureBox = picture.getBoundingClientRect()
	const fitted = contained_image_box(
		{ width: imgBox.width, height: imgBox.height },
		{ width: img.naturalWidth, height: img.naturalHeight },
	)
	if (!fitted) return
	painted.value = {
		top: imgBox.top - pictureBox.top + fitted.top,
		left: imgBox.left - pictureBox.left + fitted.left,
		width: fitted.width,
		height: fitted.height,
	}
}

let observer: ResizeObserver | null = null

function onLoad(event: Event) {
	if (event.target instanceof HTMLImageElement) layoutText()
}

onMounted(() => {
	const picture = pictureEl.value
	if (!picture) return
	observer = new ResizeObserver(() => layoutText())
	observer.observe(picture)
	picture.addEventListener('load', onLoad, true)
	layoutText()
})

onBeforeUnmount(() => {
	observer?.disconnect()
	pictureEl.value?.removeEventListener('load', onLoad, true)
})
</script>

<template>
	<div class="figure" :class="[mode, { 'image-caption': hanging }]">
		<p v-if="title" class="title" :style="titleStyle">{{ title }}</p>
		<div ref="pictureEl" class="picture">
			<slot />
		</div>
		<p v-if="description" class="caption" :style="captionStyle">{{ description }}</p>
	</div>
</template>

<style scoped>
.figure {
	min-width: 0;
	min-height: 0;
}

.title,
.caption {
	margin: 0;
	flex-shrink: 0;
	text-align: center;
	overflow-wrap: anywhere;
	user-select: none;
}

.title {
	font-size: 13px;
	font-weight: 600;
	line-height: 1.3;
	color: var(--text-primary);
}

.caption {
	font-size: 12px;
	line-height: 1.35;
	color: var(--text-muted);
}

.figure.outside {
	position: relative;
	height: 100%;
	border-radius: inherit;
}

.figure.outside .picture {
	height: 100%;
	overflow: hidden;
	border-radius: inherit;
}

.figure.outside .title,
.figure.outside .caption {
	position: absolute;
	left: 0;
	right: 0;
}

.figure.outside .title {
	top: 0;
	transform: translateY(calc(-100% - 10px));
}

.figure.outside .caption {
	top: 100%;
	margin-top: 10px;
}

.figure.stack {
	display: flex;
	flex-direction: column;
	height: 100%;
}

.figure.stack .picture {
	flex: 1;
	min-height: 0;
	display: flex;
	flex-direction: column;
}

.figure.stack .picture > :deep(*) {
	flex: 1;
	min-height: 0;
	height: 100%;
}

.figure.stack .title {
	padding: 4px 8px 10px;
}

.figure.stack .caption {
	padding: 10px 8px 4px;
}

.figure.grow {
	display: flex;
	flex-direction: column;
	width: 100%;
}

.figure.grow .title {
	padding: 6px 8px 10px;
}

.figure.grow .caption {
	padding: 10px 8px 6px;
}
</style>

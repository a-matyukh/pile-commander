<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
	/** card: board and canvas, the text sits inside the card above and below the picture. stack: fills a cell. grow: the card grows. */
	mode: 'card' | 'stack' | 'grow'
	title?: string
	description?: string
}>()

/** A card with text lays out like a cell; without text it is the picture alone. */
const layout = computed(() =>
	props.mode === 'card' ? (props.title || props.description ? 'stack card' : 'bare') : props.mode,
)
</script>

<template>
	<div class="figure" :class="layout">
		<p v-if="title" class="title">{{ title }}</p>
		<div class="picture">
			<slot />
		</div>
		<p v-if="description" class="caption">{{ description }}</p>
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

.figure.bare {
	height: 100%;
	border-radius: inherit;
}

.figure.bare .picture {
	height: 100%;
	overflow: hidden;
	border-radius: inherit;
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

/* On the board and canvas the card's fill takes the text in: room from its edges. */
.figure.card {
	border-radius: inherit;
}

.figure.card .title {
	padding: 12px 12px 8px;
}

.figure.card .caption {
	padding: 8px 12px 12px;
}

.figure.card .picture {
	overflow: hidden;
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

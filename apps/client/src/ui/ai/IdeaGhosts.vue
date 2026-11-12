<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { t } from '@/i18n'
import { NEW_NOTE_SIZE } from '@/services/ai/newNotes'
import { ideas_on_board, ideas_session, type IdeaRow } from '@/store/aiIdeas'
import type { BoardViewport } from '@/ui/workspace/folder-container/canvas/drawing/types'
import { useViewportLayerStyle } from '@/ui/workspace/folder-container/canvas/drawing/useViewportLayerStyle'
import IdeaNotePreview from './IdeaNotePreview.vue'
import { idea_title_of, ideas_flow, ideas_planned, ideas_rows } from './ideasFlow'

/**
 * Proposed notes on a Board or a Canvas, in board coordinates, where each
 * note will be written: cards with a dashed edge and an "AI" badge, checked
 * until clicked. They are not widgets: not in the folder, not selectable,
 * nothing on disk. On a Canvas `viewport` maps them onto the screen as the
 * other overlay layers do.
 */
const props = defineProps<{ folderId: string; viewport?: BoardViewport }>()
const emit = defineEmits<{ reveal: [rect: { x: number; y: number; width: number; height: number }] }>()

const shown = computed(() => ideas_on_board.value && ideas_session.folder_id === props.folderId)
const cards = computed(() => (shown.value
	? ideas_rows.value
		.map((row, index) => ({ row, index }))
		.filter(({ row }) => row.position && row.status !== 'created')
	: []))

const transform = useViewportLayerStyle(() => props.viewport ?? { x: 0, y: 0, zoom: 1 })
const layer_style = computed(() => (props.viewport ? transform.value : undefined))

/** The size the note will have: what shows on the card is what shows on the board */
const width = NEW_NOTE_SIZE.width
const height = NEW_NOTE_SIZE.height

function toggle(row: IdeaRow) {
	if (row.status !== 'ready' || ideas_flow.phase !== 'review') return
	row.checked = !row.checked
}

const layer = ref<HTMLElement | null>(null)
let revealed_run = -1

// The first cards of a session are brought into view if they fall outside it
watch(() => cards.value.length, async (count) => {
	if (!count || revealed_run === ideas_session.run) return
	revealed_run = ideas_session.run
	await nextTick()
	if (props.viewport) {
		const placed = cards.value.map(({ row }) => row.position!)
		const left = Math.min(...placed.map(spot => spot.x))
		const top = Math.min(...placed.map(spot => spot.y))
		const right = Math.max(...placed.map(spot => spot.x + width))
		const bottom = Math.max(...placed.map(spot => spot.y + height))
		emit('reveal', { x: left, y: top, width: right - left, height: bottom - top })
		return
	}
	const first = layer.value?.querySelector<HTMLElement>('.idea-ghost')
	first?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
})
</script>

<template>
	<div v-if="cards.length" ref="layer" class="idea-ghosts" :style="layer_style" aria-live="polite">
		<div
			v-for="({ row, index }, order) in cards"
			:key="row.key"
			class="idea-ghost nodrag nopan"
			:class="{ 'idea-ghost--off': !row.checked, 'idea-ghost--writing': row.status === 'writing', 'idea-ghost--failed': row.status === 'failed' }"
			:style="{ left: `${row.position!.x}px`, top: `${row.position!.y}px`, width: `${width}px`, height: `${height}px`, '--i': order }"
			role="checkbox"
			:aria-checked="row.checked"
			:aria-disabled="row.status !== 'ready' || ideas_flow.phase !== 'review'"
			:aria-label="t('ideas.check', { name: idea_title_of(ideas_planned[index] ?? row.name) })"
			tabindex="0"
			@pointerdown.stop
			@click.stop="toggle(row)"
			@dblclick.stop
			@contextmenu.stop.prevent
			@keydown.space.prevent="toggle(row)"
			@keydown.enter.prevent="toggle(row)"
		>
			<div class="idea-ghost__head">
				<span class="idea-ghost__badge">
					<UIcon name="i-lucide:sparkles" class="size-3" />
					AI
				</span>
				<UIcon v-if="row.status === 'writing'" name="i-lucide:loader-circle" class="ml-auto size-3.5 animate-spin text-muted" />
				<span v-else class="idea-ghost__check" :class="{ 'idea-ghost__check--on': row.checked }">
					<UIcon v-if="row.checked" name="i-lucide:check" class="size-3" />
				</span>
			</div>
			<p class="idea-ghost__title">{{ idea_title_of(ideas_planned[index] ?? row.name) }}</p>
			<div v-if="row.status === 'writing' && !row.text.includes('\n')" class="idea-ghost__skeleton">
				<span />
				<span class="idea-ghost__skeleton--short" />
			</div>
			<IdeaNotePreview v-else :text="row.text" class="idea-ghost__body" />
			<p v-if="row.status === 'failed' && row.error" class="idea-ghost__error">{{ row.error }}</p>
		</div>
	</div>
</template>

<style scoped>
.idea-ghosts {
	position: absolute;
	left: 0;
	top: 0;
	width: 0;
	height: 0;
	overflow: visible;
	pointer-events: none;
	z-index: 10000;
	transform-origin: 0 0;
}

.idea-ghost {
	position: absolute;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	box-sizing: border-box;
	padding: 8px 10px 10px;
	border: 1.5px dashed color-mix(in oklab, var(--pc-accent) 60%, transparent);
	border-radius: 10px;
	background: color-mix(in oklab, white 94%, var(--pc-accent));
	box-shadow:
		0 0 0 4px color-mix(in oklab, var(--pc-accent) 8%, transparent),
		0 12px 24px -16px color-mix(in oklab, var(--pc-accent) 70%, transparent);
	pointer-events: auto;
	cursor: pointer;
	text-align: left;
	animation: idea-ghost-in 0.35s cubic-bezier(0.2, 0.9, 0.3, 1.15) both;
	animation-delay: calc(var(--i) * 70ms);
}

.idea-ghost:focus-visible {
	outline: 2px solid var(--pc-accent);
	outline-offset: 2px;
}

.idea-ghost--off {
	opacity: 0.45;
	border-color: var(--pc-gray-border);
	box-shadow: none;
}

.idea-ghost--writing {
	cursor: default;
}

.idea-ghost--failed {
	border-color: rgb(239 68 68 / 0.7);
}

.idea-ghost__head {
	display: flex;
	align-items: center;
	gap: 6px;
}

.idea-ghost__badge {
	display: inline-flex;
	align-items: center;
	gap: 3px;
	border-radius: 999px;
	background: color-mix(in oklab, var(--pc-accent) 12%, transparent);
	padding: 1px 7px;
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.02em;
	color: var(--pc-accent);
}

.idea-ghost__check {
	display: grid;
	place-items: center;
	margin-left: auto;
	width: 16px;
	height: 16px;
	border-radius: 4px;
	border: 1.5px solid var(--pc-gray-border);
	background: white;
	color: white;
}

.idea-ghost__check--on {
	border-color: var(--pc-accent);
	background: var(--pc-accent);
}

.idea-ghost__title {
	margin: 6px 0 0;
	font-size: 13px;
	font-weight: 600;
	line-height: 1.3;
	color: #1e293b;
}

.idea-ghost__body {
	flex: 1;
	min-height: 0;
	margin-top: 2px;
	font-size: 12px;
	line-height: 1.4;
	mask-image: linear-gradient(to bottom, black 70%, transparent);
}

.idea-ghost__skeleton {
	display: flex;
	flex-direction: column;
	gap: 6px;
	margin-top: 8px;
}

.idea-ghost__skeleton span {
	display: block;
	height: 9px;
	border-radius: 4px;
	background: linear-gradient(90deg, hsl(213 40% 93%) 0%, hsl(213 60% 97%) 50%, hsl(213 40% 93%) 100%);
	background-size: 200% 100%;
	animation: idea-ghost-shimmer 1.2s linear infinite;
}

.idea-ghost__skeleton--short {
	width: 60%;
}

.idea-ghost__error {
	margin: 4px 0 0;
	font-size: 11px;
	color: rgb(220 38 38);
}

@keyframes idea-ghost-in {
	from {
		opacity: 0;
		transform: translateY(8px) scale(0.92);
	}
}

@keyframes idea-ghost-shimmer {
	to {
		background-position: -200% 0;
	}
}

@media (prefers-reduced-motion: reduce) {
	.idea-ghost,
	.idea-ghost__skeleton span {
		animation: none;
	}
}
</style>

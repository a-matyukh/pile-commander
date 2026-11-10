<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue'
import type { Connection, ConnectionMarker } from '@/domain/Widget'
import { t } from '@/i18n'
import type { EditorTool } from '../drawing/types'
import CanvasDockButton from './CanvasDockButton.vue'

/**
 * The strip above the canvas panel: what the chosen tool or the selection
 * offers. The pen's color and width, a delete for selected strokes, the look
 * of the one selected connection. The panel itself keeps its width.
 */
const props = defineProps<{
	tool: EditorTool
	penColor: string
	penWidth: number
	selectedStrokeCount: number
	selectedConnection?: Connection | null
	/** The canvas is too narrow for the pen's colors and widths in one row */
	stacked?: boolean
}>()

type ConnectionPatch = Partial<Pick<Connection, 'marker_start' | 'marker_end' | 'is_animated'>>

const emit = defineEmits<{
	'update:penColor': [color: string]
	'update:penWidth': [width: number]
	'delete-selected': []
	'update-connection': [patch: ConnectionPatch]
	'delete-connection': []
}>()

/** The classic toolbar's colors */
const PEN_PALETTE = ['#111827', '#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899']
const PEN_WIDTHS = [2, 4, 8, 16]

const same_color = (color: string) => color.toLowerCase() === props.penColor.toLowerCase()
const custom_color = computed(() => !PEN_PALETTE.some(same_color))

const MARKERS: { key: 'none' | 'arrow' | 'closed'; value: ConnectionMarker | undefined; start: string; end: string }[] = [
	{ key: 'none', value: undefined, start: 'tabler:minus', end: 'tabler:minus' },
	{ key: 'arrow', value: 'arrow', start: 'tabler:arrow-narrow-left', end: 'tabler:arrow-narrow-right' },
	{ key: 'closed', value: 'arrowclosed', start: 'tabler:caret-left-filled', end: 'tabler:caret-right-filled' },
]

/** No marker is stored as nothing at all, or as null by an older client */
const same_marker = (a: ConnectionMarker | null | undefined, b: ConnectionMarker | undefined) => (a ?? null) === (b ?? null)

const strokes_label = computed(() =>
	t(props.selectedStrokeCount === 1 ? 'canvas_dock.delete_stroke' : 'canvas_dock.delete_strokes'),
)

/**
 * A delete acts on the press, as the classic toolbar's: by the click the
 * selection it is about may be gone. A click without a press is the keyboard.
 */
function on_press(event: PointerEvent, what: 'delete-selected' | 'delete-connection') {
	if (event.button !== 0) return
	if (what === 'delete-selected') emit('delete-selected')
	else emit('delete-connection')
}

function on_key_click(event: MouseEvent, what: 'delete-selected' | 'delete-connection') {
	if (event.detail !== 0) return
	if (what === 'delete-selected') emit('delete-selected')
	else emit('delete-connection')
}
</script>

<template>
	<div class="strip" role="group" :aria-label="t('canvas_dock.properties')">
		<div v-if="tool === 'pen'" class="pen" :class="{ stacked }">
			<div class="sec colors" role="group" :aria-label="t('canvas_dock.pen_color')">
				<button
					v-for="color in PEN_PALETTE"
					:key="color"
					type="button"
					class="sw"
					:class="{ on: same_color(color) }"
					:style="{ background: color }"
					:aria-label="color"
					:aria-pressed="same_color(color)"
					@mousedown.prevent
					@click="emit('update:penColor', color)"
				/>
				<label
					class="sw custom"
					:class="{ on: custom_color }"
					:style="custom_color ? { background: penColor } : undefined"
					:data-tip="t('canvas_dock.custom_color')"
					data-tip-side="top"
				>
					<Icon v-if="!custom_color" icon="tabler:palette" />
					<span class="sr">{{ t('canvas_dock.custom_color') }}</span>
					<input
						type="color"
						:value="penColor"
						@input="emit('update:penColor', ($event.target as HTMLInputElement).value)"
					>
				</label>
			</div>
			<div class="sec">
				<CanvasDockButton
					v-for="width in PEN_WIDTHS"
					:key="width"
					:selected="penWidth === width"
					:aria-label="t('canvas_dock.pen_width', { n: width })"
					:aria-pressed="penWidth === width"
					:data-tip="t('canvas_dock.pen_width', { n: width })"
					@click="emit('update:penWidth', width)"
				>
					<i class="dot" :style="{ width: `${width + 2}px`, height: `${width + 2}px`, background: penColor }" />
				</CanvasDockButton>
			</div>
		</div>

		<div v-if="selectedStrokeCount > 0" class="sec">
			<button
				type="button"
				class="act"
				@mousedown.prevent
				@pointerdown="on_press($event, 'delete-selected')"
				@click="on_key_click($event, 'delete-selected')"
			>
				<Icon icon="tabler:trash" />
				<span>{{ strokes_label }}</span>
			</button>
		</div>

		<template v-if="selectedConnection">
			<div class="sec" role="group" :aria-label="t('canvas_dock.connection')">
				<CanvasDockButton
					v-for="marker in MARKERS"
					:key="`start-${marker.key}`"
					:icon="marker.start"
					:selected="same_marker(selectedConnection.marker_start, marker.value)"
					:aria-label="t(`canvas_dock.start_${marker.key}`)"
					:aria-pressed="same_marker(selectedConnection.marker_start, marker.value)"
					:data-tip="t(`canvas_dock.start_${marker.key}`)"
					@click="emit('update-connection', { marker_start: marker.value })"
				/>
			</div>
			<div class="sec">
				<CanvasDockButton
					icon="tabler:line-dashed"
					:selected="selectedConnection.is_animated"
					:aria-label="t('canvas_dock.animated')"
					:aria-pressed="selectedConnection.is_animated"
					:data-tip="t('canvas_dock.animated')"
					@click="emit('update-connection', { is_animated: !selectedConnection.is_animated })"
				/>
			</div>
			<div class="sec">
				<CanvasDockButton
					v-for="marker in MARKERS"
					:key="`end-${marker.key}`"
					:icon="marker.end"
					:selected="same_marker(selectedConnection.marker_end, marker.value)"
					:aria-label="t(`canvas_dock.end_${marker.key}`)"
					:aria-pressed="same_marker(selectedConnection.marker_end, marker.value)"
					:data-tip="t(`canvas_dock.end_${marker.key}`)"
					@click="emit('update-connection', { marker_end: marker.value })"
				/>
			</div>
			<div class="sec">
				<CanvasDockButton
					icon="tabler:trash"
					class="danger"
					:aria-label="t('canvas_dock.delete_connection')"
					:data-tip="t('canvas_dock.delete_connection')"
					@pointerdown="on_press($event, 'delete-connection')"
					@click="on_key_click($event, 'delete-connection')"
				/>
			</div>
		</template>
	</div>
</template>

<style scoped>
/* A narrow canvas wraps the sections onto a second row; nothing is cut off */
.strip {
	--dock-btn: 32px;
	--dock-btn-radius: 8px;
	--dock-icon: 18px;
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	justify-content: center;
	gap: 4px 10px;
	box-sizing: border-box;
	max-width: 100%;
	padding: 4px;
	border: 0.5px solid var(--border-strong);
	border-radius: 12px;
	background: var(--surface-3);
	box-shadow: 0 8px 24px rgba(0, 0, 0, .1), 0 2px 6px rgba(0, 0, 0, .06);
	pointer-events: auto;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}
.explorer.manim .strip {
	animation: strip-in .14s ease-out;
}
@keyframes strip-in {
	from {
		opacity: 0;
		transform: translateY(4px);
	}
}
/* Colors over widths on a narrow canvas: the strip stays as wide as its longer row */
.pen {
	display: flex;
	align-items: center;
	gap: 4px 10px;
}
.pen.stacked {
	flex-direction: column;
}
.sec {
	display: flex;
	align-items: center;
	gap: 2px;
}
.sec.colors {
	gap: 8px;
	padding: 0 6px;
	height: var(--dock-btn);
}
.sw {
	position: relative;
	display: flex;
	align-items: center;
	justify-content: center;
	flex: none;
	width: 20px;
	height: 20px;
	padding: 0;
	border: 0;
	border-radius: 50%;
	cursor: pointer;
	box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, .2);
	-webkit-tap-highlight-color: transparent;
}
.sw.on {
	box-shadow: 0 0 0 2px var(--surface-3), 0 0 0 3.5px var(--fill-accent);
}
.sw:focus-visible,
.sw.custom:focus-within {
	outline: 2px solid var(--fill-accent);
	outline-offset: 3px;
}
/* Any color: the system's picker behind a swatch */
.sw.custom {
	color: var(--text-secondary);
	background: var(--surface-0);
	font-size: 14px;
}
.sw.custom input {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	padding: 0;
	border: 0;
	opacity: 0;
	cursor: pointer;
}
.sr {
	position: absolute;
	width: 1px;
	height: 1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
}
.dot {
	display: block;
	border-radius: 50%;
	box-shadow: inset 0 0 0 0.5px rgba(0, 0, 0, .2);
}
.act {
	display: flex;
	align-items: center;
	gap: 6px;
	height: var(--dock-btn);
	padding: 0 10px 0 8px;
	border: 0;
	border-radius: var(--dock-btn-radius);
	background: none;
	color: var(--text-danger);
	font: inherit;
	font-size: 12px;
	white-space: nowrap;
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}
.act :deep(svg) {
	font-size: 16px;
}
.act:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
@media (hover: hover) {
	.act:hover {
		background: var(--surface-1);
	}
}
</style>

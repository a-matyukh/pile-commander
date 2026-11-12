<script setup lang="ts">
import { computed, ref } from 'vue'
import { useElementSize, useMediaQuery } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import type { Connection } from '@/domain/Widget'
import { t } from '@/i18n'
import { is_mac_user_agent } from '@/services/window/trafficInset'
import DropMenu from '@/ui/kit/DropMenu.vue'
import MenuItem from '@/ui/kit/MenuItem.vue'
import MenuLabel from '@/ui/kit/MenuLabel.vue'
import MenuSeparator from '@/ui/kit/MenuSeparator.vue'
import type { EditorTool } from '../drawing/types'
import CanvasDockButton from './CanvasDockButton.vue'
import CanvasDockContext from './CanvasDockContext.vue'
import { DOCK_TOOLS, dock_items, dock_tool, type DockItemId, type DockTool, type DockZoomAction } from './canvasDockItems'
import { DOCK_METRICS, dock_layout } from './canvasDockLayout'
import { useCloseOnCanvasPress } from './useCloseOnCanvasPress'

/**
 * The canvas panel: one island at the bottom center with undo, the tools and
 * the zoom, and above it a strip with what the chosen tool or the selection
 * offers. What does not fit the canvas's width goes under "more".
 *
 * No `pointerdown.stop` on it: an open menu elsewhere must close on a press
 * here, and a tooltip must hide.
 */
const props = defineProps<{
	/** The tool the person chose */
	tool: EditorTool
	/** Space is held: Hand shows as the tool in use until it is let go */
	spacePan?: boolean
	zoomPercent: number
	canWrite: boolean
	/** A folder preview's panel: smaller, no undo, no hotkeys */
	embedded?: boolean
	canUndo?: boolean
	canRedo?: boolean
	penColor: string
	penWidth: number
	selectedStrokeCount: number
	selectedConnection?: Connection | null
}>()

type ConnectionPatch = Partial<Pick<Connection, 'marker_start' | 'marker_end' | 'is_animated'>>

const emit = defineEmits<{
	'update:tool': [tool: EditorTool]
	'update:penColor': [color: string]
	'update:penWidth': [width: number]
	'delete-selected': []
	'update-connection': [patch: ConnectionPatch]
	'delete-connection': []
	zoom: [action: DockZoomAction]
	undo: []
	redo: []
}>()

const host = ref<HTMLElement | null>(null)
const { width } = useElementSize(host)

const metrics = computed(() => (props.embedded ? DOCK_METRICS.small : DOCK_METRICS.regular))
const items = computed(() => dock_items({ can_write: props.canWrite, embedded: !!props.embedded }))
const layout = computed(() => dock_layout(items.value, width.value, metrics.value))

/** The items on the panel, by group: a separator goes between groups */
const groups = computed(() => {
	const group_of = new Map(items.value.map(item => [item.id, item.group]))
	const list: { key: number; ids: DockItemId[] }[] = []
	for (const id of layout.value.inline) {
		const key = group_of.get(id) ?? 0
		const last = list[list.length - 1]
		if (last && last.key === key) last.ids.push(id)
		else list.push({ key, ids: [id] })
	}
	return list
})

const tucked = (id: DockItemId) => layout.value.overflow.includes(id)
const tucked_tools = computed(() => DOCK_TOOLS.filter(tool => tucked(tool.id)))

const tool_in_use = computed<EditorTool>(() => (props.spacePan ? 'hand' : props.tool))
/** The tool in use sits under "more": its button shows that tool */
const tucked_in_use = computed(() => tucked_tools.value.find(tool => tool.id === tool_in_use.value))

const zoom_open = ref(false)
const more_open = ref(false)
useCloseOnCanvasPress(zoom_open)
useCloseOnCanvasPress(more_open)

/** A folder preview shows its panel on hover; these keep it there */
const pinned = computed(() => props.tool !== 'hand' || zoom_open.value || more_open.value)

const has_context = computed(() =>
	props.canWrite && (props.tool === 'pen' || props.selectedStrokeCount > 0 || !!props.selectedConnection),
)

/** The pen's colors and widths side by side, with the strip's padding and border */
const PEN_ROW_WIDTH = 444
const strip_stacked = computed(() => width.value < PEN_ROW_WIDTH)

/** Hotkey hints are for a keyboard at hand, as the menus' own: not a touch screen */
const has_keyboard = useMediaQuery('(hover: hover) and (pointer: fine)')

const mac = is_mac_user_agent(navigator.userAgent)
const undo_key = mac ? '⌘Z' : 'Ctrl+Z'
const redo_key = mac ? '⇧⌘Z' : 'Ctrl+Shift+Z'

/** A preview does not hear the keys, so its tooltips do not promise them */
function tool_key(tool: DockTool): string | undefined {
	if (props.embedded) return undefined
	return tool.id === 'hand' ? `${tool.hotkey} · ${t('canvas_dock.space')}` : tool.hotkey
}

const vars = computed(() => ({
	'--dock-btn': `${metrics.value.button}px`,
	'--dock-gap': `${metrics.value.gap}px`,
	'--dock-sep': `${metrics.value.sep}px`,
	'--dock-pad': `${metrics.value.pad}px`,
	'--dock-zoom': `${metrics.value.zoom}px`,
}))
</script>

<template>
	<div
		ref="host"
		class="canvas-dock board-no-drag nodrag nopan"
		:class="{
			'canvas-dock--small': embedded,
			'canvas-dock--pinned': pinned,
			'canvas-dock--unmeasured': width <= 0,
		}"
		:style="vars"
	>
		<CanvasDockContext
			v-if="has_context"
			:tool="tool"
			:pen-color="penColor"
			:pen-width="penWidth"
			:selected-stroke-count="selectedStrokeCount"
			:selected-connection="selectedConnection"
			:stacked="strip_stacked"
			@update:pen-color="emit('update:penColor', $event)"
			@update:pen-width="emit('update:penWidth', $event)"
			@delete-selected="emit('delete-selected')"
			@update-connection="emit('update-connection', $event)"
			@delete-connection="emit('delete-connection')"
		/>

		<div class="island" role="toolbar" :aria-label="t('canvas_dock.label')">
			<template v-for="(group, index) in groups" :key="group.key">
				<span v-if="index > 0" class="sep" aria-hidden="true" />
				<div class="grp">
					<template v-for="id in group.ids" :key="id">
						<CanvasDockButton
							v-if="id === 'undo'"
							icon="tabler:arrow-back-up"
							:off="!canUndo"
							:aria-label="t('canvas_dock.undo')"
							:data-tip="t('canvas_dock.undo')"
							:data-tip-key="undo_key"
							@click="emit('undo')"
						/>
						<CanvasDockButton
							v-else-if="id === 'redo'"
							icon="tabler:arrow-forward-up"
							:off="!canRedo"
							:aria-label="t('canvas_dock.redo')"
							:data-tip="t('canvas_dock.redo')"
							:data-tip-key="redo_key"
							@click="emit('redo')"
						/>
						<DropMenu v-else-if="id === 'zoom'" v-model:open="zoom_open" side="top" align="end" :width="200" :offset="10">
							<template #trigger>
								<button
									type="button"
									class="zoom"
									:aria-label="`${t('canvas_dock.zoom')} ${zoomPercent}%`"
									:data-tip="t('canvas_dock.zoom')"
									data-tip-side="top"
									@mousedown.prevent
								>
									<span>{{ zoomPercent }}%</span>
									<Icon icon="tabler:chevron-up" />
								</button>
							</template>
							<MenuItem icon="tabler:zoom-in" :label="t('canvas_dock.zoom_in')" keep_open @select="emit('zoom', 'in')" />
							<MenuItem icon="tabler:zoom-out" :label="t('canvas_dock.zoom_out')" keep_open @select="emit('zoom', 'out')" />
							<MenuSeparator />
							<MenuItem icon="tabler:maximize" :label="t('canvas_dock.zoom_fit')" @select="emit('zoom', 'fit')" />
							<MenuItem icon="tabler:zoom-reset" label="100%" @select="emit('zoom', 'reset')" />
						</DropMenu>
						<CanvasDockButton
							v-else-if="dock_tool(id)"
							:icon="dock_tool(id)!.icon"
							:selected="tool_in_use === id"
							:aria-label="t(dock_tool(id)!.label_key)"
							:aria-pressed="tool_in_use === id"
							:data-tip="t(dock_tool(id)!.label_key)"
							:data-tip-key="tool_key(dock_tool(id)!)"
							@click="emit('update:tool', dock_tool(id)!.id)"
						/>
					</template>
				</div>
			</template>

			<template v-if="layout.more">
				<span v-if="groups.length > 0" class="sep" aria-hidden="true" />
				<DropMenu v-model:open="more_open" side="top" align="end" :width="220" :offset="10">
					<template #trigger>
						<CanvasDockButton
							:icon="tucked_in_use?.icon ?? 'tabler:dots'"
							:selected="!!tucked_in_use"
							:aria-label="t('canvas_dock.more')"
							:data-tip="t('canvas_dock.more')"
						/>
					</template>
					<template v-if="tucked('undo') || tucked('redo')">
						<MenuItem
							v-if="tucked('undo')"
							icon="tabler:arrow-back-up"
							:label="t('canvas_dock.undo')"
							:disabled="!canUndo"
							@select="emit('undo')"
						/>
						<MenuItem
							v-if="tucked('redo')"
							icon="tabler:arrow-forward-up"
							:label="t('canvas_dock.redo')"
							:disabled="!canRedo"
							@select="emit('redo')"
						/>
						<MenuSeparator />
					</template>
					<MenuItem
						v-for="item in tucked_tools"
						:key="item.id"
						:icon="item.icon"
						:label="t(item.label_key)"
						:shortcut="embedded || !has_keyboard ? undefined : item.hotkey"
						:current="tool_in_use === item.id"
						@select="emit('update:tool', item.id)"
					/>
					<template v-if="tucked('zoom')">
						<MenuSeparator />
						<MenuLabel :label="`${t('canvas_dock.zoom')} · ${zoomPercent}%`" />
						<MenuItem icon="tabler:zoom-in" :label="t('canvas_dock.zoom_in')" keep_open @select="emit('zoom', 'in')" />
						<MenuItem icon="tabler:zoom-out" :label="t('canvas_dock.zoom_out')" keep_open @select="emit('zoom', 'out')" />
						<MenuItem icon="tabler:maximize" :label="t('canvas_dock.zoom_fit')" @select="emit('zoom', 'fit')" />
						<MenuItem icon="tabler:zoom-reset" label="100%" @select="emit('zoom', 'reset')" />
					</template>
				</DropMenu>
			</template>
		</div>
	</div>
</template>

<style scoped>
.canvas-dock {
	--dock-radius: 14px;
	--dock-btn-radius: 10px;
	--dock-icon: 20px;
	position: absolute;
	left: 8px;
	right: 8px;
	bottom: calc(12px + env(safe-area-inset-bottom, 0px));
	/* Above the folder actions panel (z-index 20) */
	z-index: 30;
	display: flex;
	flex-direction: column;
	align-items: center;
	gap: 8px;
	/* The row is only a measure of the canvas's width: clicks beside the island reach the canvas */
	pointer-events: none;
}
.canvas-dock--small {
	--dock-radius: 10px;
	--dock-btn-radius: 7px;
	--dock-icon: 16px;
	bottom: 8px;
	gap: 6px;
}
/* The width is not known yet: not a frame of the wrong set of buttons */
.canvas-dock--unmeasured {
	visibility: hidden;
}
.island {
	display: flex;
	align-items: center;
	padding: var(--dock-pad);
	border: 0.5px solid var(--border-strong);
	border-radius: var(--dock-radius);
	background: var(--surface-3);
	/* Over any background a folder may have, so always with a shadow */
	box-shadow: 0 8px 24px rgba(0, 0, 0, .1), 0 2px 6px rgba(0, 0, 0, .06);
	pointer-events: auto;
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
}
.grp {
	display: flex;
	align-items: center;
	gap: var(--dock-gap);
}
/* A hairline in the middle of the separator's whole width, which the layout counts */
.sep {
	flex: none;
	width: var(--dock-sep);
	height: calc(var(--dock-btn) * .55);
	background: linear-gradient(var(--border-strong), var(--border-strong)) center / 1px 100% no-repeat;
}
.zoom {
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 2px;
	flex: none;
	width: var(--dock-zoom);
	height: var(--dock-btn);
	padding: 0;
	border: 0;
	border-radius: var(--dock-btn-radius);
	background: none;
	color: var(--text-primary);
	font: inherit;
	font-size: 12px;
	font-variant-numeric: tabular-nums;
	cursor: pointer;
	-webkit-tap-highlight-color: transparent;
}
.zoom :deep(svg) {
	font-size: 14px;
	color: var(--text-muted);
}
.zoom[data-state='open'] {
	background: var(--surface-1);
}
.zoom:focus-visible {
	outline: 2px solid var(--fill-accent);
	outline-offset: 1px;
}
@media (hover: hover) {
	.zoom:hover {
		background: var(--surface-1);
	}
}
</style>

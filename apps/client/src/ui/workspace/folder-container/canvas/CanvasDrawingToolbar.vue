<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { onClickOutside } from '@vueuse/core'
import type { Connection, ConnectionMarker } from '@/domain/Widget'
import type { EditorTool } from './drawing/types'
import type { CanvasToolbarSide } from './useCanvasToolbarPrefs'
import { CANVAS_TOOL_HOTKEYS } from './useCanvasToolShortcuts'
import { useHoverClickMenu } from './useHoverClickMenu'

const props = defineProps<{
	tool: EditorTool
	penColor: string
	penWidth: number
	selectedStrokeCount: number
	/** Set when exactly one canvas edge is selected — shows its props controls. */
	selectedConnection?: Connection | null
	compact?: boolean
	compactView?: boolean
	side?: CanvasToolbarSide
}>()

type ConnectionPropsPatch = Partial<
	Pick<Connection, 'marker_start' | 'marker_end' | 'is_animated'>
>

const emit = defineEmits<{
	'update:tool': [tool: EditorTool]
	'update:penColor': [color: string]
	'update:penWidth': [width: number]
	'delete-selected': []
	'update-connection': [patch: ConnectionPropsPatch]
	'delete-connection': []
}>()

const deleteSelectedLabel = computed(() =>
	props.selectedStrokeCount === 1 ? 'Delete stroke' : 'Delete strokes',
)

const markerOptions: {
	value: ConnectionMarker | undefined
	label: string
	iconStart: string
	iconEnd: string
	flipStart?: boolean
}[] = [
	{ value: undefined, label: 'None', iconStart: 'i-lucide-minus', iconEnd: 'i-lucide-minus' },
	{ value: 'arrow', label: 'Arrow', iconStart: 'i-lucide-arrow-left', iconEnd: 'i-lucide-arrow-right' },
	{ value: 'arrowclosed', label: 'Closed arrow', iconStart: 'i-lucide-play', iconEnd: 'i-lucide-play', flipStart: true },
]

function isMarkerActive(side: 'start' | 'end', value: ConnectionMarker | undefined) {
	const current = side === 'start'
		? props.selectedConnection?.marker_start
		: props.selectedConnection?.marker_end
	return (current ?? null) === (value ?? null)
}

const currentStartMarker = computed(() =>
	markerOptions.find(option => isMarkerActive('start', option.value)) ?? markerOptions[0]!,
)
const currentEndMarker = computed(() =>
	markerOptions.find(option => isMarkerActive('end', option.value)) ?? markerOptions[0]!,
)

const {
	menuRef: startMarkerMenuRef,
	open: startMarkerMenuOpen,
	openIfFine: openStartMarkerMenuIfFine,
	closeIfFine: closeStartMarkerMenuIfFine,
	onFocusOut: onStartMarkerMenuFocusOut,
	toggleIfCoarse: toggleStartMarkerMenuIfCoarse,
	close: closeStartMarkerMenu,
} = useHoverClickMenu()
const startMarkerMenuId = useId()

const {
	menuRef: endMarkerMenuRef,
	open: endMarkerMenuOpen,
	openIfFine: openEndMarkerMenuIfFine,
	closeIfFine: closeEndMarkerMenuIfFine,
	onFocusOut: onEndMarkerMenuFocusOut,
	toggleIfCoarse: toggleEndMarkerMenuIfCoarse,
	close: closeEndMarkerMenu,
} = useHoverClickMenu()
const endMarkerMenuId = useId()

function pickStartMarker(value: ConnectionMarker | undefined) {
	emit('update-connection', { marker_start: value })
	closeStartMarkerMenu()
}

function pickEndMarker(value: ConnectionMarker | undefined) {
	emit('update-connection', { marker_end: value })
	closeEndMarkerMenu()
}

type ToolbarTool = { id: EditorTool; label: string; icon: string }

const navigateTools: ToolbarTool[] = [
	{ id: 'hand', label: 'Hand', icon: 'i-lucide-hand' },
	{ id: 'select', label: 'Select', icon: 'i-lucide-mouse-pointer-2' },
	{ id: 'lasso', label: 'Lasso', icon: 'i-lucide-lasso' },
]

const connectionTools: ToolbarTool[] = [
	{ id: 'connect', label: 'Connect', icon: 'i-lucide-spline' },
	{ id: 'disconnect', label: 'Disconnect', icon: 'i-lucide-unlink' },
]

const inkTools: ToolbarTool[] = [
	{ id: 'pen', label: 'Pen', icon: 'i-lucide-pen' },
	{ id: 'eraser', label: 'Eraser', icon: 'i-lucide-eraser' },
]

const toolGroups = [navigateTools, connectionTools, inkTools]
const allTools = [...navigateTools, ...connectionTools, ...inkTools]
const currentTool = computed(() =>
	allTools.find(item => item.id === props.tool) ?? navigateTools[0]!,
)

const {
	menuRef: toolMenuRef,
	open: toolMenuOpen,
	openIfFine: openToolMenuIfFine,
	closeIfFine: closeToolMenuIfFine,
	onFocusOut: onToolMenuFocusOut,
	toggleIfCoarse: toggleToolMenuIfCoarse,
	close: closeToolMenu,
} = useHoverClickMenu()
const toolMenuId = useId()

function pickTool(id: EditorTool) {
	emit('update:tool', id)
	closeToolMenu()
}

const palette = [
	'#111827',
	'#ef4444',
	'#f97316',
	'#eab308',
	'#22c55e',
	'#3b82f6',
	'#8b5cf6',
	'#ec4899',
]

type ToolbarMenu = 'color' | 'width'

const openMenu = ref<ToolbarMenu | null>(null)
const colorMenuRef = ref<HTMLElement | null>(null)
const widthMenuRef = ref<HTMLElement | null>(null)

function toggleMenu(menu: ToolbarMenu) {
	openMenu.value = openMenu.value === menu ? null : menu
}

function closeMenus() {
	openMenu.value = null
}

function pickColor(color: string) {
	emit('update:penColor', color)
	closeMenus()
}

onClickOutside(colorMenuRef, () => {
	if (openMenu.value === 'color') closeMenus()
})

onClickOutside(widthMenuRef, () => {
	if (openMenu.value === 'width') closeMenus()
})

watch(
	() => props.tool,
	() => closeMenus(),
)

watch(
	() => props.compactView,
	() => closeToolMenu(),
)

watch(
	() => props.selectedConnection?.id,
	() => {
		closeStartMarkerMenu()
		closeEndMarkerMenu()
	},
)
</script>

<template>
	<header
		class="canvas-drawing-toolbar"
		:class="{
			'canvas-drawing-toolbar--compact': compact,
			'canvas-drawing-toolbar--bottom': side === 'bottom',
		}"
		@pointerdown.stop
	>
		<div class="canvas-drawing-toolbar__tools" role="toolbar" aria-label="Canvas tools">
			<div
				v-if="compactView"
				ref="toolMenuRef"
				class="canvas-drawing-toolbar__picker"
				@mouseenter="openToolMenuIfFine"
				@mouseleave="closeToolMenuIfFine"
				@focusin="openToolMenuIfFine"
				@focusout="onToolMenuFocusOut"
				@keydown.escape="closeToolMenu"
			>
				<button
					type="button"
					class="canvas-drawing-toolbar__tool canvas-drawing-toolbar__picker-trigger"
					:aria-expanded="toolMenuOpen"
					aria-haspopup="true"
					:aria-controls="toolMenuId"
					:title="currentTool.label"
					:aria-label="`${currentTool.label}, canvas tools`"
					@click="toggleToolMenuIfCoarse"
				>
					<UIcon :name="currentTool.icon" class="canvas-drawing-toolbar__icon" />
					<span v-if="!compact">{{ currentTool.label }}</span>
					<UIcon
						:name="side === 'bottom' ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
						class="canvas-drawing-toolbar__chevron"
						:class="{ 'canvas-drawing-toolbar__chevron--open': toolMenuOpen }"
					/>
				</button>
				<div
					v-show="toolMenuOpen"
					:id="toolMenuId"
					class="canvas-drawing-toolbar__picker-panel"
					role="menu"
					aria-label="Canvas tools"
				>
					<button
						v-for="item in allTools"
						:key="item.id"
						type="button"
						class="canvas-drawing-toolbar__picker-item"
						:class="{ 'canvas-drawing-toolbar__picker-item--active': tool === item.id }"
						role="menuitem"
						@click="pickTool(item.id)"
					>
						<UIcon :name="item.icon" class="canvas-drawing-toolbar__icon" />
						<span>{{ item.label }}</span>
						<span class="canvas-drawing-toolbar__picker-kbd">
							<UKbd :value="CANVAS_TOOL_HOTKEYS[item.id]" size="sm" />
						</span>
					</button>
				</div>
			</div>

			<template v-if="!compactView">
			<UFieldGroup
				v-for="group in toolGroups"
				:key="group[0]!.id"
				class="canvas-drawing-toolbar__group"
			>
				<span
					v-for="(item, index) in group"
					:key="item.id"
					class="canvas-drawing-toolbar__tip"
					:class="{
						'canvas-drawing-toolbar__tip--start': index === 0,
						'canvas-drawing-toolbar__tip--end': index === group.length - 1,
					}"
				>
					<UTooltip
						:text="item.label"
						:kbds="[CANVAS_TOOL_HOTKEYS[item.id]]"
						:ui="{ kbds: 'inline-flex' }"
					>
						<button
							type="button"
							class="canvas-drawing-toolbar__tool"
							:class="{ 'canvas-drawing-toolbar__tool--active': tool === item.id }"
							:aria-label="item.label"
							:aria-pressed="tool === item.id"
							@click="emit('update:tool', item.id)"
						>
							<UIcon :name="item.icon" class="canvas-drawing-toolbar__icon" />
							<span v-if="!compact">{{ item.label }}</span>
						</button>
					</UTooltip>
				</span>
			</UFieldGroup>
			</template>

			<UFieldGroup v-if="tool === 'pen'" class="canvas-drawing-toolbar__group">
				<div ref="colorMenuRef" class="canvas-drawing-toolbar__menu">
					<button
						type="button"
						class="canvas-drawing-toolbar__tool canvas-drawing-toolbar__menu-trigger"
						:aria-expanded="openMenu === 'color'"
						:aria-label="compact ? 'Color' : undefined"
						:title="compact ? 'Color' : undefined"
						aria-haspopup="true"
						@click="toggleMenu('color')"
					>
						<span
							class="canvas-drawing-toolbar__swatch"
							:style="{ backgroundColor: penColor }"
							aria-hidden="true"
						/>
						<span v-if="!compact">Color</span>
					</button>
					<div
						v-show="openMenu === 'color'"
						class="canvas-drawing-toolbar__menu-panel"
						role="group"
						aria-label="Stroke color"
					>
						<div class="canvas-drawing-toolbar__colors">
							<button
								v-for="color in palette"
								:key="color"
								type="button"
								class="canvas-drawing-toolbar__color-btn"
								:class="{ 'canvas-drawing-toolbar__color-btn--active': penColor === color }"
								:style="{ backgroundColor: color }"
								:aria-label="`Color ${color}`"
								@click="pickColor(color)"
							/>
							<label class="canvas-drawing-toolbar__color-picker">
								<span class="sr-only">Custom color</span>
								<input
									type="color"
									:value="penColor"
									@input="pickColor(($event.target as HTMLInputElement).value)"
								/>
							</label>
						</div>
					</div>
				</div>

				<div ref="widthMenuRef" class="canvas-drawing-toolbar__menu">
					<button
						type="button"
						class="canvas-drawing-toolbar__tool canvas-drawing-toolbar__menu-trigger"
						:aria-expanded="openMenu === 'width'"
						:aria-label="compact ? `Width ${penWidth}px` : undefined"
						:title="compact ? `Width ${penWidth}px` : undefined"
						aria-haspopup="true"
						@click="toggleMenu('width')"
					>
						<span v-if="!compact">Width</span>
						<span class="canvas-drawing-toolbar__meta">{{ penWidth }}px</span>
					</button>
					<div
						v-show="openMenu === 'width'"
						class="canvas-drawing-toolbar__menu-panel canvas-drawing-toolbar__menu-panel--width"
						role="group"
						aria-label="Stroke width"
					>
						<label class="canvas-drawing-toolbar__width">
							<input
								type="range"
								min="1"
								max="24"
								:value="penWidth"
								@input="emit('update:penWidth', Number(($event.target as HTMLInputElement).value))"
							/>
							<span>{{ penWidth }}px</span>
						</label>
					</div>
				</div>
			</UFieldGroup>
		</div>

		<div
			v-if="selectedStrokeCount > 0"
			class="canvas-drawing-toolbar__selection"
		>
			<button
				type="button"
				class="canvas-drawing-toolbar__delete"
				:aria-label="deleteSelectedLabel"
				:title="deleteSelectedLabel"
				@pointerdown.stop="emit('delete-selected')"
				@click.prevent.stop
			>
				<UIcon name="i-lucide-trash-2" class="canvas-drawing-toolbar__icon" />
				<span v-if="!compact">{{ deleteSelectedLabel }}</span>
			</button>
		</div>

		<div
			v-if="selectedConnection"
			class="canvas-drawing-toolbar__selection"
		>
			<UFieldGroup class="canvas-drawing-toolbar__group" role="group" aria-label="Connection style">
				<div
					ref="startMarkerMenuRef"
					class="canvas-drawing-toolbar__picker"
					@mouseenter="openStartMarkerMenuIfFine"
					@mouseleave="closeStartMarkerMenuIfFine"
					@focusin="openStartMarkerMenuIfFine"
					@focusout="onStartMarkerMenuFocusOut"
					@keydown.escape="closeStartMarkerMenu"
				>
					<button
						type="button"
						class="canvas-drawing-toolbar__tool"
						:aria-expanded="startMarkerMenuOpen"
						aria-haspopup="true"
						:aria-controls="startMarkerMenuId"
						:title="`Start marker: ${currentStartMarker.label}`"
						:aria-label="`Start marker: ${currentStartMarker.label}`"
						@click="toggleStartMarkerMenuIfCoarse"
					>
						<UIcon
							:name="currentStartMarker.iconStart"
							class="canvas-drawing-toolbar__icon"
							:class="{ 'canvas-drawing-toolbar__icon--flip': currentStartMarker.flipStart }"
						/>
					</button>
					<div
						v-show="startMarkerMenuOpen"
						:id="startMarkerMenuId"
						class="canvas-drawing-toolbar__picker-panel"
						role="menu"
						aria-label="Start marker"
					>
						<button
							v-for="option in markerOptions"
							:key="`start-${option.value ?? 'none'}`"
							type="button"
							class="canvas-drawing-toolbar__picker-item"
							:class="{ 'canvas-drawing-toolbar__picker-item--active': isMarkerActive('start', option.value) }"
							role="menuitem"
							@click="pickStartMarker(option.value)"
						>
							<UIcon
								:name="option.iconStart"
								class="canvas-drawing-toolbar__icon"
								:class="{ 'canvas-drawing-toolbar__icon--flip': option.flipStart }"
							/>
							<span>{{ option.label }}</span>
						</button>
					</div>
				</div>

				<button
					type="button"
					class="canvas-drawing-toolbar__tool"
					:class="{ 'canvas-drawing-toolbar__tool--active': selectedConnection.is_animated }"
					aria-label="Animated"
					title="Animated"
					:aria-pressed="selectedConnection.is_animated"
					@click="emit('update-connection', { is_animated: !selectedConnection.is_animated })"
				>
					<UIcon name="i-tabler-line-dashed" class="canvas-drawing-toolbar__icon" /> Animated
				</button>

				<div
					ref="endMarkerMenuRef"
					class="canvas-drawing-toolbar__picker"
					@mouseenter="openEndMarkerMenuIfFine"
					@mouseleave="closeEndMarkerMenuIfFine"
					@focusin="openEndMarkerMenuIfFine"
					@focusout="onEndMarkerMenuFocusOut"
					@keydown.escape="closeEndMarkerMenu"
				>
					<button
						type="button"
						class="canvas-drawing-toolbar__tool"
						:aria-expanded="endMarkerMenuOpen"
						aria-haspopup="true"
						:aria-controls="endMarkerMenuId"
						:title="`End marker: ${currentEndMarker.label}`"
						:aria-label="`End marker: ${currentEndMarker.label}`"
						@click="toggleEndMarkerMenuIfCoarse"
					>
						<UIcon :name="currentEndMarker.iconEnd" class="canvas-drawing-toolbar__icon" />
					</button>
					<div
						v-show="endMarkerMenuOpen"
						:id="endMarkerMenuId"
						class="canvas-drawing-toolbar__picker-panel"
						role="menu"
						aria-label="End marker"
					>
						<button
							v-for="option in markerOptions"
							:key="`end-${option.value ?? 'none'}`"
							type="button"
							class="canvas-drawing-toolbar__picker-item"
							:class="{ 'canvas-drawing-toolbar__picker-item--active': isMarkerActive('end', option.value) }"
							role="menuitem"
							@click="pickEndMarker(option.value)"
						>
							<UIcon :name="option.iconEnd" class="canvas-drawing-toolbar__icon" />
							<span>{{ option.label }}</span>
						</button>
					</div>
				</div>
			</UFieldGroup>

			<button
				type="button"
				class="canvas-drawing-toolbar__delete"
				aria-label="Delete connection"
				title="Delete connection"
				@pointerdown.stop="emit('delete-connection')"
				@click.prevent.stop
			>
				<UIcon name="i-lucide-trash-2" class="canvas-drawing-toolbar__icon" />
			</button>
		</div>
	</header>
</template>

<style scoped>
.canvas-drawing-toolbar {
	position: absolute;
	top: 0;
	left: 0;
	right: 0;
	display: flex;
	align-items: center;
	gap: 0.5rem;
	flex-wrap: wrap;
	padding: 0.5rem 0.75rem;
	background: transparent;
	pointer-events: none;
	z-index: 10;
}

.canvas-drawing-toolbar--bottom {
	top: auto;
	bottom: 0;
	padding-right: 5.5rem;
}

.canvas-drawing-toolbar__tools,
.canvas-drawing-toolbar__selection {
	display: flex;
	align-items: center;
	gap: 0.375rem;
	flex-wrap: wrap;
	pointer-events: auto;
}

.canvas-drawing-toolbar__group {
	border-radius: 0.5rem;
	overflow: visible;
}

.canvas-drawing-toolbar__tip {
	display: inline-flex;
}

.canvas-drawing-toolbar__group :deep(button.canvas-drawing-toolbar__tool) {
	border-radius: 0;
	box-shadow: none;
}

.canvas-drawing-toolbar__group :deep(.canvas-drawing-toolbar__tip--start button.canvas-drawing-toolbar__tool),
.canvas-drawing-toolbar__group :deep(.canvas-drawing-toolbar__menu:first-child .canvas-drawing-toolbar__tool),
.canvas-drawing-toolbar__group :deep(.canvas-drawing-toolbar__picker:first-child .canvas-drawing-toolbar__tool) {
	border-top-left-radius: 0.5rem;
	border-bottom-left-radius: 0.5rem;
}

.canvas-drawing-toolbar__group :deep(.canvas-drawing-toolbar__tip--end button.canvas-drawing-toolbar__tool),
.canvas-drawing-toolbar__group :deep(.canvas-drawing-toolbar__menu:last-child .canvas-drawing-toolbar__tool),
.canvas-drawing-toolbar__group :deep(.canvas-drawing-toolbar__picker:last-child .canvas-drawing-toolbar__tool) {
	border-top-right-radius: 0.5rem;
	border-bottom-right-radius: 0.5rem;
}

.canvas-drawing-toolbar__tool {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.375rem;
	min-height: 44px;
	min-width: 44px;
	padding: 0.375rem 0.75rem;
	border: 1px solid var(--pc-border);
	border-radius: 0.5rem;
	background: white;
	color: #111827;
	font-size: 0.875rem;
	cursor: pointer;
	user-select: none;
}

.canvas-drawing-toolbar--compact .canvas-drawing-toolbar__tool {
	min-width: 36px;
	min-height: 36px;
	padding: 0.25rem;
}

.canvas-drawing-toolbar__icon {
	width: 1rem;
	height: 1rem;
	flex-shrink: 0;
}

.canvas-drawing-toolbar__icon--flip {
	transform: rotate(180deg);
}

.canvas-drawing-toolbar__caption {
	font-size: 0.75rem;
	color: #6b7280;
	text-shadow: 0 0 6px #fff, 0 1px 2px #fff;
	user-select: none;
}

.canvas-drawing-toolbar__tool--active {
	border-color: #2563eb;
	background: #eff6ff;
	color: #2563eb;
	position: relative;
	z-index: 1;
}

.canvas-drawing-toolbar__menu {
	position: relative;
	display: inline-flex;
}

.canvas-drawing-toolbar__menu-panel {
	position: absolute;
	top: calc(100% + 4px);
	left: 0;
	z-index: 20;
	padding: 0.5rem;
	border: 1px solid var(--pc-border);
	border-radius: 0.5rem;
	background: white;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.canvas-drawing-toolbar--bottom .canvas-drawing-toolbar__menu-panel {
	top: auto;
	bottom: calc(100% + 4px);
}

.canvas-drawing-toolbar__menu-panel--width {
	min-width: 180px;
}

.canvas-drawing-toolbar__colors {
	display: flex;
	flex-wrap: wrap;
	gap: 0.375rem;
	align-items: center;
}

.canvas-drawing-toolbar__color-btn {
	width: 28px;
	height: 28px;
	border: 2px solid transparent;
	border-radius: 9999px;
	cursor: pointer;
}

.canvas-drawing-toolbar__color-btn--active {
	border-color: #2563eb;
}

.canvas-drawing-toolbar__color-picker input {
	width: 28px;
	height: 28px;
	padding: 0;
	border: none;
	background: none;
	cursor: pointer;
}

.canvas-drawing-toolbar__swatch {
	width: 16px;
	height: 16px;
	border-radius: 9999px;
	border: 1px solid rgba(0, 0, 0, 0.15);
	flex-shrink: 0;
}

.canvas-drawing-toolbar__meta {
	color: #6b7280;
	font-size: 0.75rem;
}

.canvas-drawing-toolbar__width {
	display: flex;
	align-items: center;
	gap: 0.5rem;
	width: 100%;
}

.canvas-drawing-toolbar__width input {
	flex: 1;
}

.canvas-drawing-toolbar__delete {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.375rem;
	min-height: 44px;
	min-width: 44px;
	padding: 0.375rem 0.75rem;
	border: 1px solid #fecaca;
	border-radius: 0.5rem;
	background: #fef2f2;
	color: #dc2626;
	font-size: 0.875rem;
	cursor: pointer;
}

.canvas-drawing-toolbar--compact .canvas-drawing-toolbar__delete {
	min-width: 36px;
	min-height: 36px;
	padding: 0.25rem;
}

.canvas-drawing-toolbar__chevron {
	width: 14px;
	height: 14px;
	flex-shrink: 0;
	color: #6b7280;
	transition: transform 0.15s ease;
}

.canvas-drawing-toolbar__chevron--open {
	transform: rotate(180deg);
}

.canvas-drawing-toolbar__picker {
	position: relative;
	display: inline-flex;
}

.canvas-drawing-toolbar--compact .canvas-drawing-toolbar__picker-trigger {
	min-width: 52px;
	padding: 0.25rem 0.375rem;
}

.canvas-drawing-toolbar__picker-panel {
	position: absolute;
	top: calc(100% + 4px);
	left: 0;
	z-index: 20;
	display: flex;
	flex-direction: column;
	gap: 0.125rem;
	min-width: 12rem;
	padding: 0.375rem;
	border: 1px solid var(--pc-border);
	border-radius: 0.5rem;
	background: white;
	box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}

.canvas-drawing-toolbar__picker-panel::after {
	content: '';
	position: absolute;
	bottom: 100%;
	right: 0;
	left: 0;
	height: 6px;
}

.canvas-drawing-toolbar--bottom .canvas-drawing-toolbar__picker-panel {
	top: auto;
	bottom: calc(100% + 4px);
}

.canvas-drawing-toolbar--bottom .canvas-drawing-toolbar__picker-panel::after {
	bottom: auto;
	top: 100%;
}

.canvas-drawing-toolbar__picker-item {
	display: inline-flex;
	align-items: center;
	gap: 0.5rem;
	width: 100%;
	min-height: 36px;
	padding: 0.375rem 0.5rem;
	border: none;
	border-radius: 0.25rem;
	background: transparent;
	color: #111827;
	font-size: 0.875rem;
	text-align: left;
	cursor: pointer;
	white-space: nowrap;
}

.canvas-drawing-toolbar__picker-item:hover {
	background: var(--pc-gray-muted);
}

.canvas-drawing-toolbar__picker-item--active {
	background: #eff6ff;
	color: #2563eb;
}

.canvas-drawing-toolbar__picker-item:focus-visible {
	outline: 2px solid #2563eb;
	outline-offset: 1px;
}

.canvas-drawing-toolbar__picker-kbd {
	margin-left: auto;
}

.sr-only {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip: rect(0, 0, 0, 0);
	white-space: nowrap;
	border: 0;
}
</style>

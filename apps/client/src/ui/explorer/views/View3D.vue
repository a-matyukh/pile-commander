<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useDocumentVisibility, useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { floor_3d_from_stored, type FolderContainerWidget, type FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import { DEFAULT_GRID_SIZE, image_shows_preview, is_note_widget, snap_position } from '@/services/board/layout'
import { get_media_kind } from '@/services/board/media'
import { entries_label, record_action } from '@/store/history'
import { explorer_settings, motion_3d_enabled } from '@/store/explorer/settings'
import { entry_is_dimmed } from '@/store/hiddenPaths'
import Button from '@/ui/kit/Button.vue'
import IconButton from '@/ui/kit/IconButton.vue'
import { keys_elsewhere } from '@/ui/explorer/folder_keys'
import { useMoveSelectedWidgets } from '@/ui/workspace/folder-container/useMoveSelectedWidgets'
import ItemDialogs from './ItemDialogs.vue'
import ItemMenu from './ItemMenu.vue'
import { use_items } from './use_items'
import { create_scene3d } from './space3d/scene3d'
import { create_scene_media } from './space3d/media'
import { to_scene_items, with_theta } from './space3d/scene_items'
import type { LabelSpot, Scene3D, SceneFrame } from './space3d/types'

/**
 * "3D": the folder's board lies as a floor in space, its cards float over it
 * and 3D models stand on it. Places are the board's and the canvas's. The
 * scene is plain TS (space3d/); this view feeds it the folder's files and
 * gives it the Explorer's selection, "⋯" and dialogs, as List and Gallery have
 */
const props = defineProps<{ workspace: WorkspaceStore; container: FolderContainerWidget; location: FolderRef }>()

const items = use_items(() => props)
const children = computed(() => props.container.children)

const stage = ref<HTMLElement | null>(null)
const badge = ref<HTMLElement | null>(null)
const failed = ref(false)
let scene: Scene3D | null = null

// ── Content ──────────────────────────────────────────────────────────────

const urls = reactive(new Map<string, string | false>())
const notes = reactive(new Map<string, string>())
const media = create_scene_media(
	props.workspace,
	(id, url) => urls.set(id, url),
	(id, text) => notes.set(id, text),
)

// Each file's content is asked for once, and again when its bytes change under
// the same id (the media cache's version, as the board's tiles watch); what
// leaves the folder is let go
watch(() => children.value.map(child => [child, props.workspace.media_cache.version(child.id)] as const), list => {
	for (const [child, version] of list) {
		if (child.type !== 'file') continue
		if (is_note_widget(child)) media.want_note(child.id)
		else if (image_shows_preview(child) || get_media_kind(child.name) === 'model') media.want_media(child.id, child.name, version)
	}
	media.keep_only(new Set(list.map(([child]) => child.id)))
}, { immediate: true })

const scene_items = computed(() => to_scene_items(children.value, child => ({
	glyph: items.glyph(child),
	url: urls.get(child.id) ?? null,
	note: notes.get(child.id) ?? null,
	cover: items.cover(child),
	name: items.display_name(child),
})))

/**
 * Folders, notes and other files carry their name on their card, as on the
 * board, where items often touch. Pictures and models have no room for it:
 * theirs is a label under them
 */
const labeled = computed(() => {
	const kinds = new Map(scene_items.value.map(item => [item.key, item.kind]))
	return children.value.filter(child => kinds.get(child.id) === 'image' || kinds.get(child.id) === 'model')
})

// ── Selection ────────────────────────────────────────────────────────────

const by_id = computed(() => new Map(children.value.map(child => [child.id, child])))
/** The selected items of this folder, in the order they were selected */
const selected_here = computed(() => props.workspace.selection.filter(id => by_id.value.has(id)))
/** The item whose "⋯" shows: the last one selected */
const primary = computed<FolderContainerWidgetChild | null>(() => {
	const ids = selected_here.value
	return ids.length ? by_id.value.get(ids[ids.length - 1]) ?? null : null
})

/** A click selects an item, or clears the selection when it is the only one selected, as in the List */
function select(key: string | null) {
	const ws = props.workspace
	if (!key) ws.clear_selection()
	else if (ws.selection.length === 1 && ws.is_selected(key)) ws.clear_selection()
	else ws.set_selection([key])
}

async function open(key: string) {
	const child = by_id.value.get(key)
	if (!child) return
	if (child.type !== 'file') {
		await scene?.fly_into(key)
		props.workspace.open(child)
		return
	}
	props.workspace.set_selection([key])
	scene?.focus(key)
}

/** The item's "⋯" opens where the item is: select it, let the scene put the "⋯" there, then open */
async function menu(key: string | null) {
	const child = key ? by_id.value.get(key) : undefined
	if (!child) return
	props.workspace.set_selection([child.id])
	await nextTick()
	scene?.sync()
	items.open_menu(child)
}

// ── Moving ───────────────────────────────────────────────────────────────

/** The board's snap: a folder that snaps on the board snaps here too */
const snap = computed(() => ({
	snap_to_grid: props.container.snap_to_grid === true,
	grid_size: props.container.grid_size && props.container.grid_size > 0 ? props.container.grid_size : DEFAULT_GRID_SIZE,
}))

/**
 * A drag in 3D is one undo, as on the board: the place it shares with the
 * board and the canvas, and the height it has only here, together
 */
function move(key: string, place: { x: number; y: number; z: number | null }) {
	const ws = props.workspace
	if (!ws.can_write) return
	const position = snap_position({ x: place.x, y: place.y }, { enabled: snap.value.snap_to_grid, size: snap.value.grid_size })
	void record_action(ws, { entry_id: key }, entries_label(ws, [key], 'undo.move_one', 'undo.move_many'), async (tx) => {
		await ws.change_position(key, position, { tx })
		if (place.z !== null) await ws.change_height(key, place.z, { tx })
	})
}

// The arrows move the selected items along the floor, as on the board
const editing_note = ref<string | null>(null)
useMoveSelectedWidgets({
	children: () => props.container.children,
	editingNoteId: editing_note,
	boardSnapSettings: snap,
	enabled: () => props.workspace.can_write,
	// 3D has no edge, as the canvas: an item placed in the negative stays there when nudged
	bounded: false,
})

const toast = useToast()

/** The help on gestures: a finger's on a touch screen, the mouse's otherwise; open until closed, per device */
const touch = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches
const tips = computed(() => [1, 2, 3, 4, 5].map(n => t(`v3d.tips_${touch ? 'touch' : 'mouse'}_${n}`)))
function toggle_tips() {
	explorer_settings.tips_3d = !explorer_settings.tips_3d
}

/** A model turned in 3D faces that way on the board too: its kept view turns with it */
function turn(key: string, yaw: number) {
	const ws = props.workspace
	if (!ws.can_write) return
	const child = by_id.value.get(key)
	const kept = child?.type === 'file' ? child.model_camera : undefined
	void ws.change_model_camera(key, with_theta(kept, -yaw))
}

// ── Handles by the "⋯": height for any item, a turn for a model; a finger or a mouse alike ──

const primary_is_model = computed(() => primary.value?.type === 'file' && get_media_kind(primary.value.name) === 'model')
let handle_press: { id: number; key: string; kind: 'height' | 'turn'; x: number; y: number } | null = null

function handle_down(kind: 'height' | 'turn', event: PointerEvent) {
	const child = primary.value
	if (!child || !scene) return
	event.preventDefault()
	event.stopPropagation()
	try {
		;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
	} catch {
		// a pointer the browser does not track: moves still arrive while over the handle
	}
	handle_press = { id: event.pointerId, key: child.id, kind, x: event.clientX, y: event.clientY }
}

function handle_move(event: PointerEvent) {
	const h = handle_press
	if (!h || event.pointerId !== h.id) return
	scene?.handle(h.key, h.kind, event.clientX - h.x, event.clientY - h.y)
}

function handle_up(event: PointerEvent, keep: boolean) {
	const h = handle_press
	if (!h || event.pointerId !== h.id) return
	handle_press = null
	scene?.handle_end(h.key, h.kind, keep)
}

// ── HTML over the scene ──────────────────────────────────────────────────

// Labels follow the scene every frame straight on the DOM, not through Vue
const labels = new Map<string, HTMLElement>()
function label_ref(key: string, el: unknown) {
	if (el instanceof HTMLElement) labels.set(key, el)
	else labels.delete(key)
}

/** Boxes of the names placed this frame, CSS px */
const placed: { x0: number; x1: number; y0: number; y1: number }[] = []

/** A name's own width, measured once per text: a box as wide as its card would hide names that do not touch */
const text_widths = new WeakMap<HTMLElement, { text: string; width: number }>()
function text_width(el: HTMLElement): number {
	const text = el.textContent ?? ''
	const known = text_widths.get(el)
	if (known?.text === text) return known.width
	const width = el.scrollWidth
	text_widths.set(el, { text, width })
	return width
}

/**
 * Names that would overlap (pictures side by side, or lying over each
 * other on the board's default grid) are not drawn over each other: the
 * selected one shows first, then the nearer one, lower on screen
 */
function on_frame(frame: SceneFrame) {
	const ws = props.workspace
	const shown: { el: HTMLElement; spot: LabelSpot; selected: boolean; text: number }[] = []
	const hidden: HTMLElement[] = []
	// widths are read before any style is written: one layout, not one per name
	for (const [key, el] of labels) {
		const spot = frame.labels.get(key)
		if (spot?.visible) shown.push({ el, spot, selected: ws.is_selected(key), text: text_width(el) })
		else hidden.push(el)
	}
	for (const el of hidden) el.style.visibility = 'hidden'
	shown.sort((a, b) => Number(b.selected) - Number(a.selected) || b.spot.y - a.spot.y)
	placed.length = 0
	for (const { el, spot, selected, text } of shown) {
		const width = Math.round(Math.max(48, Math.min(200, spot.width + 12)))
		const half = Math.min(width, text) / 2
		const box = { x0: spot.x - half, x1: spot.x + half, y0: spot.y + 4, y1: spot.y + 22 }
		if (placed.some(p => box.x0 < p.x1 && p.x0 < box.x1 && box.y0 < p.y1 && p.y0 < box.y1)) {
			el.style.visibility = 'hidden'
			continue
		}
		placed.push(box)
		el.style.visibility = 'visible'
		el.style.opacity = spot.covered && !selected ? '0.22' : ''
		el.style.maxWidth = width + 'px'
		el.style.transform = `translate(${spot.x.toFixed(1)}px, ${(spot.y + 4).toFixed(1)}px) translateX(-50%)`
	}
	const b = badge.value
	if (!b) return
	if (frame.badge) {
		b.style.visibility = 'visible'
		b.style.transform = `translate(${frame.badge.x.toFixed(1)}px, ${frame.badge.y.toFixed(1)}px)`
	} else b.style.visibility = 'hidden'
}

// ── The scene ────────────────────────────────────────────────────────────

/** Animations as the setting says: on, off, or as the system's reduced motion */
const system_motion = usePreferredReducedMotion()
const motion = computed(() => motion_3d_enabled(explorer_settings.motion_3d, system_motion.value === 'reduce'))
/** The floor this folder has, chosen in the View menu */
const floor = computed(() => floor_3d_from_stored(props.container.floor_3d))
/** The folder's grid on the floor: the canvas's own setting, shown unless turned off */
const grid = computed(() => props.container.show_grid_dots !== false)

onMounted(() => {
	if (!stage.value) return
	try {
		scene = create_scene3d(stage.value, {
			font: getComputedStyle(stage.value).getPropertyValue('--font-sans').trim() || 'sans-serif',
			motion: motion.value,
			floor: floor.value,
			grid: grid.value,
			movable: props.workspace.can_write,
			text: { loading: t('v3d.loading'), failed: t('v3d.model_failed') },
			on_select: select,
			on_open: key => void open(key),
			on_move: move,
			on_menu: key => void menu(key),
			on_frame,
			on_hint: () => toast.add({ title: t('v3d.height_hint') }),
			on_turn: turn,
		})
	} catch (error) {
		// no WebGL: the folder can still open as a board
		console.warn('[3d] the scene is unavailable', error)
		failed.value = true
		return
	}
	scene.set_items(scene_items.value)
	scene.set_selected(selected_here.value)
})

onBeforeUnmount(() => {
	scene?.dispose()
	scene = null
	media.dispose()
})

watch(scene_items, list => scene?.set_items(list))
watch(selected_here, ids => scene?.set_selected(ids))
watch(motion, on => scene?.set_motion(on))
watch(floor, mode => scene?.set_floor(mode))
watch(grid, on => scene?.set_grid(on))
// a folder that turns read-only (a share taken away) stops moving at once
watch(() => props.workspace.can_write, on => scene?.set_movable(on))

const visibility = useDocumentVisibility()
watch(visibility, v => scene?.set_active(v === 'visible'))

/** Esc drops the selection, then brings the camera back */
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
	if (event.key !== 'Escape' || !scene || keys_elsewhere(event)) return
	if (props.workspace.selection.length) props.workspace.clear_selection()
	else if (scene.away) scene.home()
	else return
	event.preventDefault()
})

function open_as_board() {
	void props.workspace.change_folder_view(props.location.folder_id, 'board').catch(() => {})
}
</script>

<template>
	<div class="v3d">
		<div v-if="failed" class="fail">
			<Icon icon="tabler:3d-cube-sphere" class="fi" />
			<div class="ft">{{ t('v3d.unavailable') }}</div>
			<div class="fd">{{ t('v3d.unavailable_d') }}</div>
			<Button v-if="workspace.can_write" icon="tabler:template" @click="open_as_board">{{ t('v3d.open_as_board') }}</Button>
		</div>
		<template v-else>
			<div ref="stage" class="stage" />
			<div class="labels" aria-hidden="true">
				<span
					v-for="child in labeled"
					:key="child.id"
					:ref="el => label_ref(child.id, el)"
					class="lb"
					:class="{
						s: workspace.is_selected(child.id),
						dim: entry_is_dimmed(child.name, child.id) || workspace.is_cut(child.id),
					}"
				>{{ items.display_name(child) }}</span>
			</div>
			<div ref="badge" class="ba">
				<span v-if="primary" class="bdt">
					<template v-if="workspace.can_write">
						<button
							type="button"
							class="hd hd-v"
							:data-tip="t('v3d.raise')"
							:aria-label="t('v3d.raise')"
							@pointerdown="handle_down('height', $event)"
							@pointermove="handle_move"
							@pointerup="handle_up($event, true)"
							@pointercancel="handle_up($event, false)"
						><Icon icon="tabler:arrows-vertical" /></button>
						<button
							v-if="primary_is_model"
							type="button"
							class="hd hd-h"
							:data-tip="t('v3d.turn')"
							:aria-label="t('v3d.turn')"
							@pointerdown="handle_down('turn', $event)"
							@pointermove="handle_move"
							@pointerup="handle_up($event, true)"
							@pointercancel="handle_up($event, false)"
						><Icon icon="tabler:rotate-360" /></button>
					</template>
					<ItemMenu :key="primary.id" :items="items" :child="primary" :workspace="workspace" />
				</span>
			</div>
			<div v-if="explorer_settings.tips_3d" class="tips" role="note">
				<div class="tt">
					<span>{{ t('v3d.tips') }}</span>
					<IconButton icon="tabler:x" :icon_size="14" :aria-label="t('dialog.close')" @click="toggle_tips" />
				</div>
				<ul>
					<li v-for="tip in tips" :key="tip">{{ tip }}</li>
				</ul>
			</div>
			<div class="bar">
				<IconButton icon="tabler:perspective" :data-tip="t('v3d.home')" @click="scene?.home()" />
				<IconButton icon="tabler:template" :data-tip="t('v3d.top')" @click="scene?.top()" />
				<div class="vsep" />
				<IconButton icon="tabler:minus" :data-tip="t('v3d.zoom_out')" @click="scene?.zoom(1.3)" />
				<IconButton icon="tabler:plus" :data-tip="t('v3d.zoom_in')" @click="scene?.zoom(1 / 1.3)" />
				<div class="vsep" />
				<IconButton icon="tabler:help-circle" :active="explorer_settings.tips_3d" :data-tip="t('v3d.tips')" :aria-label="t('v3d.tips')" @click="toggle_tips" />
			</div>
		</template>
		<ItemDialogs :items="items" />
	</div>
</template>

<style scoped>
.v3d {
	position: absolute;
	inset: 0;
	overflow: hidden;
	/* a double tap opens or focuses, it never selects the page's text (iOS) */
	user-select: none;
	-webkit-user-select: none;
	-webkit-touch-callout: none;
	-webkit-tap-highlight-color: transparent;
	/* the canvas is transparent: around the floor is the folder's own background, as in the other views */
	background: var(--ct);
}
.stage {
	position: absolute;
	inset: 0;
	outline: none;
}
.labels {
	position: absolute;
	inset: 0;
	pointer-events: none;
	overflow: hidden;
}
.lb {
	position: absolute;
	left: 0;
	top: 0;
	box-sizing: border-box;
	font-size: 11px;
	line-height: 1.3;
	color: var(--text-primary);
	padding: 1px 5px;
	border-radius: 4px;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
	text-shadow: 0 0 3px var(--surface-2), 0 0 2px var(--surface-2), 0 0 1px var(--surface-2);
	visibility: hidden;
	will-change: transform;
}
.lb.dim {
	color: var(--text-muted);
}
.lb.s {
	background: var(--fill-accent);
	color: var(--on-accent);
	text-shadow: none;
}
.explorer.lg .lb {
	font-size: 13px;
}
/* the "⋯" of the selected item, at its top-right corner */
.ba {
	position: absolute;
	left: 0;
	top: 0;
	width: 0;
	height: 0;
	z-index: 2;
	visibility: hidden;
}
.bdt {
	position: absolute;
	top: -12px;
	right: -12px;
	display: flex;
	background: var(--surface-3, #fff);
	border: 0.5px solid var(--border-strong);
	border-radius: 8px;
	box-shadow: 0 2px 6px rgba(0, 0, 0, .08);
}
/* the help on gestures, above the toolbar */
.tips {
	position: absolute;
	left: 50%;
	bottom: 64px;
	transform: translateX(-50%);
	width: min(340px, calc(100% - 24px));
	padding: 8px 12px 10px;
	background: var(--surface-3, #fff);
	border: 0.5px solid var(--border-strong);
	border-radius: 10px;
	box-shadow: 0 4px 14px rgba(0, 0, 0, .08);
	font-size: 12px;
	line-height: 1.45;
	color: var(--text-secondary);
	z-index: 2;
}
.tt {
	display: flex;
	align-items: center;
	justify-content: space-between;
	font-weight: 600;
	color: var(--text-primary);
}
.tips ul {
	margin: 4px 0 0;
	padding-left: 16px;
}
/* handles by the "⋯": dragged, not clicked */
.hd {
	display: flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	padding: 0;
	border: none;
	background: none;
	color: var(--text-secondary);
	font-size: 16px;
	touch-action: none;
}
.hd-v {
	cursor: ns-resize;
}
.hd-h {
	cursor: ew-resize;
}
.hd:hover {
	color: var(--text-primary);
}
.bar {
	position: absolute;
	left: 50%;
	bottom: 14px;
	transform: translateX(-50%);
	display: flex;
	align-items: center;
	gap: 2px;
	padding: 4px;
	background: var(--surface-3, #fff);
	border: 0.5px solid var(--border-strong);
	border-radius: 12px;
	box-shadow: 0 6px 20px rgba(0, 0, 0, .10);
	z-index: 2;
}
.bar :deep(.ib) {
	height: 32px;
	min-width: 32px;
	border-radius: 8px;
}
.bar :deep(.ib svg) {
	font-size: 18px;
}
.explorer.lg .bar :deep(.ib) {
	height: 40px;
	min-width: 40px;
}
.vsep {
	width: 0.5px;
	height: 16px;
	background: var(--border-strong);
	margin: 0 6px;
}
.fail {
	position: absolute;
	inset: 0;
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 8px;
	padding: 24px;
	text-align: center;
	color: var(--text-secondary);
}
.fi {
	font-size: 34px;
	color: var(--text-muted);
}
.ft {
	font-size: 14px;
	font-weight: 500;
	color: var(--text-primary);
}
.fd {
	max-width: 360px;
	font-size: 12px;
	line-height: 1.45;
	margin-bottom: 6px;
}
</style>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useDocumentVisibility, useEventListener, usePreferredReducedMotion } from '@vueuse/core'
import { Icon } from '@iconify/vue'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { t } from '@/i18n'
import { DEFAULT_GRID_SIZE, image_shows_preview, is_note_widget, snap_position } from '@/services/board/layout'
import { get_media_kind } from '@/services/board/media'
import { entries_label, record_action } from '@/store/history'
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
import { to_scene_items } from './space3d/scene_items'
import type { Scene3D, SceneFrame } from './space3d/types'

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

// Each file's content is asked for once; what leaves the folder is let go
watch(children, list => {
	for (const child of list) {
		if (child.type !== 'file') continue
		if (is_note_widget(child)) media.want_note(child.id)
		else if (image_shows_preview(child) || get_media_kind(child.name) === 'model') media.want_media(child.id, child.name)
	}
	media.keep_only(new Set(list.map(child => child.id)))
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
})

const toast = useToast()

// ── HTML over the scene ──────────────────────────────────────────────────

// Labels follow the scene every frame straight on the DOM, not through Vue
const labels = new Map<string, HTMLElement>()
function label_ref(key: string, el: unknown) {
	if (el instanceof HTMLElement) labels.set(key, el)
	else labels.delete(key)
}

function on_frame(frame: SceneFrame) {
	for (const [key, el] of labels) {
		const spot = frame.labels.get(key)
		if (!spot?.visible) {
			el.style.visibility = 'hidden'
			continue
		}
		el.style.visibility = 'visible'
		el.style.opacity = spot.covered && !props.workspace.is_selected(key) ? '0.22' : ''
		el.style.maxWidth = Math.round(Math.max(48, Math.min(200, spot.width + 12))) + 'px'
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

/** Until the setting comes, animations follow the system's reduced motion */
const system_motion = usePreferredReducedMotion()
const motion = computed(() => system_motion.value !== 'reduce')

onMounted(() => {
	if (!stage.value) return
	try {
		scene = create_scene3d(stage.value, {
			font: getComputedStyle(stage.value).getPropertyValue('--font-sans').trim() || 'sans-serif',
			motion: motion.value,
			movable: props.workspace.can_write,
			text: { loading: t('v3d.loading'), failed: t('v3d.model_failed') },
			on_select: select,
			on_open: key => void open(key),
			on_move: move,
			on_menu: key => void menu(key),
			on_frame,
			on_hint: () => toast.add({ title: t('v3d.height_hint') }),
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
					<ItemMenu :key="primary.id" :items="items" :child="primary" :workspace="workspace" />
				</span>
			</div>
			<div class="bar">
				<IconButton icon="tabler:perspective" :data-tip="t('v3d.home')" @click="scene?.home()" />
				<IconButton icon="tabler:template" :data-tip="t('v3d.top')" @click="scene?.top()" />
				<div class="vsep" />
				<IconButton icon="tabler:minus" :data-tip="t('v3d.zoom_out')" @click="scene?.zoom(1.3)" />
				<IconButton icon="tabler:plus" :data-tip="t('v3d.zoom_in')" @click="scene?.zoom(1 / 1.3)" />
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
	/* the canvas is transparent: the room around the floor is CSS */
	background: radial-gradient(ellipse at 50% 32%, var(--ct) 0%, color-mix(in srgb, var(--ct) 93%, #33415c) 100%);
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

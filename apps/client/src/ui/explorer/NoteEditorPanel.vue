<script setup lang="ts">
/**
 * The note editor (stage 3 of the text plan in pile-commander-product, prototype P2): the file
 * the Explorer's place names (`location.file_id`) in a window over its
 * folder, over the whole folder area, or over the whole window; the size is
 * remembered. The same engine and popup as a note on a board, larger type,
 * saved as you type. Back, ✕ and Esc return to the folder with the file
 * selected; Forward opens it again. The window over the folder moves by its
 * header and resizes by its edges; its place is remembered too.
 */
import { computed, defineAsyncComponent, nextTick, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue'
import { t } from '@/i18n'
import { track_unsaved_write } from '@/services/workspace/xattrs'
import store from '@/store'
import { folder_basename } from '@/store/explorer/folder_header'
import { explorer_navigation } from '@/store/explorer/navigation'
import IconButton from '@/ui/kit/IconButton.vue'
import { loadNoteEditor } from '@/ui/workspace/folder-container/widgets/noteRenderer'
import { use_overlay_titlebar } from '@/services/window/macOverlayChrome'
import { traffic_inset_target } from '@/services/window/trafficInset'

type Size = 'float' | 'folder' | 'window'

const SIZE_KEY = 'pc.note_editor.size'
const SIZES: { id: Size; icon: string }[] = [
	{ id: 'float', icon: 'tabler:app-window' },
	{ id: 'folder', icon: 'tabler:folder' },
	{ id: 'window', icon: 'tabler:arrows-maximize' },
]

function read_size(): Size {
	try {
		const saved = localStorage.getItem(SIZE_KEY)
		if (saved === 'float' || saved === 'folder' || saved === 'window') return saved
	} catch {
		// No storage: the default
	}
	return 'float'
}

const size = ref<Size>(read_size())

function set_size(next: Size) {
	size.value = next
	try {
		localStorage.setItem(SIZE_KEY, next)
	} catch {
		// Not remembered this time
	}
}

// ─── The window's place ────────────────────────────────────────────────────

/** In pixels of the folder area, from its top left corner. */
type Rect = { x: number; y: number; width: number; height: number }
type Edge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'

const RECT_KEY = 'pc.note_editor.rect'
const EDGES: Edge[] = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']
const MIN_WIDTH = 360
const MIN_HEIGHT = 220

function read_rect(): Rect | null {
	try {
		const saved: unknown = JSON.parse(localStorage.getItem(RECT_KEY) ?? 'null')
		if (saved && typeof saved === 'object') {
			const { x, y, width, height } = saved as Record<string, unknown>
			if ([x, y, width, height].every(value => typeof value === 'number' && Number.isFinite(value))) {
				return { x, y, width, height } as Rect
			}
		}
	} catch {
		// No storage, or an entry it cannot read: the window's own place
	}
	return null
}

/** Null: the window's own place, along the folder's right side. */
const rect = ref<Rect | null>(read_rect())

function save_rect() {
	try {
		if (rect.value) localStorage.setItem(RECT_KEY, JSON.stringify(rect.value))
	} catch {
		// Not remembered this time
	}
}

/** The folder area the window sits in. */
const area = ref<{ width: number; height: number } | null>(null)
/** The window is being moved by its header: the grip shows as held. */
const moving = ref(false)
const panel = useTemplateRef<HTMLElement>('panel')
let area_observer: ResizeObserver | null = null

function observe_area() {
	area_observer?.disconnect()
	area_observer = null
	const parent = panel.value?.offsetParent
	if (!(parent instanceof HTMLElement)) return
	const measure = () => {
		area.value = { width: parent.clientWidth, height: parent.clientHeight }
	}
	measure()
	area_observer = new ResizeObserver(measure)
	area_observer.observe(parent)
}

watch([panel, size], observe_area, { flush: 'post' })
onBeforeUnmount(() => area_observer?.disconnect())

/** Inside the folder area, never smaller than a few lines of text (unless the area is). */
function clamp(next: Rect, bounds: { width: number; height: number }): Rect {
	const width = Math.min(Math.max(next.width, MIN_WIDTH), bounds.width)
	const height = Math.min(Math.max(next.height, MIN_HEIGHT), bounds.height)
	return {
		x: Math.round(Math.min(Math.max(next.x, 0), bounds.width - width)),
		y: Math.round(Math.min(Math.max(next.y, 0), bounds.height - height)),
		width: Math.round(width),
		height: Math.round(height),
	}
}

/** A smaller folder area (a narrower window) moves the window in, not out of sight. */
const float_style = computed(() => {
	if (size.value !== 'float' || !rect.value || !area.value) return undefined
	const { x, y, width, height } = clamp(rect.value, area.value)
	return { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px`, right: 'auto', bottom: 'auto' }
})

/** An edge or a corner pulled by `dx`, `dy`: the opposite side stays. */
function resized(from: Rect, edge: Edge, dx: number, dy: number, bounds: { width: number; height: number }): Rect {
	let { x, y, width, height } = from
	const right = from.x + from.width
	const bottom = from.y + from.height
	if (edge.includes('e')) width = Math.min(Math.max(from.width + dx, MIN_WIDTH), bounds.width - from.x)
	if (edge.includes('s')) height = Math.min(Math.max(from.height + dy, MIN_HEIGHT), bounds.height - from.y)
	if (edge.includes('w')) {
		x = Math.min(Math.max(from.x + dx, 0), right - MIN_WIDTH)
		width = right - x
	}
	if (edge.includes('n')) {
		y = Math.min(Math.max(from.y + dy, 0), bottom - MIN_HEIGHT)
		height = bottom - y
	}
	return clamp({ x, y, width, height }, bounds)
}

/** Moves the window (its header) or resizes it (an edge), while the pointer is down. */
function start_gesture(event: PointerEvent, kind: 'move' | Edge) {
	const element = panel.value
	const bounds = area.value
	if (size.value !== 'float' || event.button !== 0 || !element || !bounds) return
	const from = rect.value
		? clamp(rect.value, bounds)
		: { x: element.offsetLeft, y: element.offsetTop, width: element.offsetWidth, height: element.offsetHeight }
	// No text selection, and the text keeps its focus and caret
	event.preventDefault()
	const handle = event.currentTarget as HTMLElement
	handle.setPointerCapture(event.pointerId)
	const { clientX, clientY } = event
	moving.value = kind === 'move'
	const move = (next: PointerEvent) => {
		const dx = next.clientX - clientX
		const dy = next.clientY - clientY
		rect.value = kind === 'move'
			? clamp({ ...from, x: from.x + dx, y: from.y + dy }, bounds)
			: resized(from, kind, dx, dy, bounds)
	}
	const end = () => {
		moving.value = false
		handle.removeEventListener('pointermove', move)
		handle.removeEventListener('pointerup', end)
		handle.removeEventListener('pointercancel', end)
		save_rect()
	}
	handle.addEventListener('pointermove', move)
	handle.addEventListener('pointerup', end)
	handle.addEventListener('pointercancel', end)
}

function on_header_pointerdown(event: PointerEvent) {
	if (event.target instanceof Element && event.target.closest('button, a, input')) return
	start_gesture(event, 'move')
}

// ─── The file ──────────────────────────────────────────────────────────────

const NoteRichEditor = defineAsyncComponent(loadNoteEditor)

/** Over the whole window on a Mac, the window's own buttons sit at the header's left, as on the top bar. */
const overlay = use_overlay_titlebar()
const traffic_inset = computed(() => size.value === 'window' && traffic_inset_target({
	enabled: overlay.enabled,
	fullscreen: overlay.fullscreen.value,
	gallery: false,
	sidebar_inline: false,
	sidebar_collapsed: false,
	drawer_open: false,
}) === 'header')

const file_id = computed(() => {
	const location = explorer_navigation.location
	return location?.kind === 'folder' ? location.file_id ?? null : null
})
const workspace = computed(() => {
	const ws = store.workspace
	return ws && !ws.is_disposed ? ws : null
})
const name = computed(() => file_id.value ? folder_basename(file_id.value) : '')
const markdown = computed(() => name.value.toLowerCase().endsWith('.md'))
const can_write = computed(() => workspace.value?.can_write !== false)

const text = ref('')
/** The file whose text is loaded; null while it loads. */
const loaded = ref<string | null>(null)
let persisted = ''
const status = ref<'saving' | 'saved' | null>(null)

let timer: ReturnType<typeof setTimeout> | null = null
let end_write: (() => void) | null = null

/** Writes the text of `id` if it changed; the board's previews of it read it again. */
async function flush(id: string | null) {
	if (timer) clearTimeout(timer)
	timer = null
	const ws = workspace.value
	const content = text.value
	if (!id || !ws || !ws.can_write || content === persisted) {
		end_write?.()
		end_write = null
		return
	}
	await ws.save_note_content(id, content)
	persisted = content
	ws.content_caches.notes.invalidate(id)
	if (text.value === content) status.value = 'saved'
	end_write?.()
	end_write = null
}

watch(file_id, async (id, previous) => {
	if (previous) await flush(previous)
	loaded.value = null
	status.value = null
	if (!id) return
	const ws = workspace.value
	if (!ws) return
	const content = await ws.content_caches.notes.get(id, () => ws.read_note_content(id))
	if (file_id.value !== id) return
	text.value = content
	persisted = content
	loaded.value = id
	await nextTick()
	focus_text()
}, { immediate: true })

// Saved as you type, a moment after the last key.
watch(text, () => {
	if (!loaded.value || text.value === persisted) return
	status.value = 'saving'
	end_write ??= track_unsaved_write()
	if (timer) clearTimeout(timer)
	const id = loaded.value
	timer = setTimeout(() => void flush(id), 600)
})

onBeforeUnmount(() => {
	void flush(loaded.value)
})

async function close() {
	await flush(loaded.value)
	await explorer_navigation.close_file()
}

const editor = useTemplateRef<{ element(): HTMLElement | null; placeCaret(point: null): void }>('editor')
const textarea = useTemplateRef<HTMLTextAreaElement>('textarea')

/** The caret goes to the end of the text, as the editor opens. */
function focus_text(attempt = 0) {
	const element = markdown.value ? editor.value?.element() : textarea.value
	if (!element) {
		if (attempt < 30) requestAnimationFrame(() => focus_text(attempt + 1))
		return
	}
	editor.value?.placeCaret(null)
	element.focus({ preventScroll: true })
}

function on_textarea_keydown(event: KeyboardEvent) {
	if (event.key !== 'Escape') return
	event.preventDefault()
	void close()
}

/** Esc anywhere in the editor closes it, unless a menu or dialog of the page has it. */
function on_keydown(event: KeyboardEvent) {
	if (event.key !== 'Escape' || event.defaultPrevented) return
	// The editor is a dialog itself: only a menu or dialog inside it keeps its Esc
	const owner = event.target instanceof Element ? event.target.closest('[role="menu"], [role="dialog"], .note-format') : null
	if (owner && owner !== event.currentTarget) return
	event.preventDefault()
	void close()
}

const status_label = computed(() => {
	if (!can_write.value) return t('note_editor.read_only')
	if (status.value === 'saving') return t('note_editor.saving')
	if (status.value === 'saved') return t('note_editor.saved')
	return ''
})
</script>

<template>
	<!-- `defer`: this mounts with the shell itself, before `.explorer` is in the document -->
	<div class="ne-root">
	<Teleport defer to=".explorer" :disabled="size !== 'window'">
		<section
			v-if="file_id"
			ref="panel"
			class="ne"
			:class="[`ne--${size}`, { 'ne--moving': moving }]"
			:style="float_style"
			role="dialog"
			:aria-label="name"
			@keydown="on_keydown"
		>
			<header class="ne-hd" :class="{ 'ne-hd--inset': traffic_inset }" @pointerdown="on_header_pointerdown">
				<span class="ne-name">{{ name }}</span>
				<span class="ne-status">{{ status_label }}</span>
				<span class="ne-spacer" />
				<IconButton
					v-for="option in SIZES"
					:key="option.id"
					:icon="option.icon"
					:selected="size === option.id"
					:data-tip="t(`note_editor.${option.id}`)"
					:aria-label="t(`note_editor.${option.id}`)"
					@click="set_size(option.id)"
				/>
				<IconButton
					icon="tabler:x"
					:data-tip="t('note_editor.close')"
					:aria-label="t('note_editor.close')"
					data-tip-key="Esc"
					@click="close"
				/>
			</header>
			<div class="ne-body">
				<template v-if="loaded === file_id">
					<NoteRichEditor
						v-if="markdown"
						ref="editor"
						v-model="text"
						:editable="can_write"
						class="ne-text note-content prose prose-gray max-w-none"
						@escape="close"
					/>
					<textarea
						v-else
						ref="textarea"
						v-model="text"
						class="ne-text ne-plain"
						:readonly="!can_write"
						@keydown="on_textarea_keydown"
					/>
				</template>
			</div>
			<template v-if="size === 'float'">
				<div
					v-for="edge in EDGES"
					:key="edge"
					class="ne-edge"
					:class="`ne-edge--${edge}`"
					@pointerdown="start_gesture($event, edge)"
				/>
			</template>
		</section>
	</Teleport>
	</div>
</template>

<style scoped>
.ne-root {
	display: contents;
}

.ne {
	position: absolute;
	z-index: 40;
	display: flex;
	flex-direction: column;
	box-sizing: border-box;
	background: var(--surface-3);
	color: var(--text-primary);
	font-size: 13px;
}

/* A window over the folder: the folder stays under it. */
.ne--float {
	top: 12px;
	right: 16px;
	bottom: 16px;
	width: min(720px, calc(100% - 32px));
	border: 0.5px solid var(--border-strong);
	border-radius: 10px;
	box-shadow: 0 12px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.06);
}

/* The folder area: the header with its path stays above. */
.ne--folder {
	inset: 0;
	border-top: 0.5px solid var(--border);
}

/* The whole window, above the sidebar and the top bar; under dialogs. */
.ne--window {
	position: fixed;
	inset: 0;
	z-index: 60;
}

.ne-hd {
	display: flex;
	align-items: center;
	gap: 2px;
	height: 40px;
	padding: 0 8px 0 16px;
	border-bottom: 0.5px solid var(--border);
	flex: none;
	user-select: none;
	-webkit-user-select: none;
}

/* Clear of the macOS window buttons: the top bar's inset and height (TopBar.vue). */
.ne-hd--inset {
	padding-left: var(--pc-traffic-inset);
	height: 47px;
}

/* The window over the folder moves by its header. */
.ne--float .ne-hd {
	touch-action: none;
	cursor: grab;
}

.ne--float.ne--moving .ne-hd {
	cursor: grabbing;
}

/* …and its edges and corners resize it. */
.ne-edge {
	position: absolute;
	z-index: 2;
	touch-action: none;
}

.ne-edge--n,
.ne-edge--s {
	left: 10px;
	right: 10px;
	height: 8px;
	cursor: ns-resize;
}

.ne-edge--e,
.ne-edge--w {
	top: 10px;
	bottom: 10px;
	width: 8px;
	cursor: ew-resize;
}

.ne-edge--n { top: -4px; }
.ne-edge--s { bottom: -4px; }
.ne-edge--e { right: -4px; }
.ne-edge--w { left: -4px; }

.ne-edge--ne,
.ne-edge--nw,
.ne-edge--se,
.ne-edge--sw {
	width: 14px;
	height: 14px;
}

.ne-edge--ne { top: -4px; right: -4px; cursor: nesw-resize; }
.ne-edge--sw { bottom: -4px; left: -4px; cursor: nesw-resize; }
.ne-edge--nw { top: -4px; left: -4px; cursor: nwse-resize; }
.ne-edge--se { bottom: -4px; right: -4px; cursor: nwse-resize; }

.ne-name {
	font-weight: 600;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.ne-status {
	margin-left: 10px;
	color: var(--text-muted);
	font-size: 12px;
	white-space: nowrap;
}

.ne-spacer {
	flex: 1;
}

.ne-body {
	flex: 1;
	min-height: 0;
	overflow: auto;
}

/* Larger type than a note on a board; a readable line. */
.ne-text {
	box-sizing: border-box;
	max-width: 760px;
	min-height: 100%;
	margin: 0 auto;
	padding: 28px 32px 64px;
	font-size: 16px;
	--tw-prose-body: rgb(23 23 23);
	--tw-prose-headings: rgb(23 23 23);
	--tw-prose-bold: rgb(23 23 23);
	--tw-prose-links: rgb(37 99 235);
	--tw-prose-code: rgb(23 23 23);
	--tw-prose-pre-code: rgb(23 23 23);
	--tw-prose-pre-bg: rgb(0 0 0 / 0.06);
	color: rgb(23 23 23);
}

.ne-text :deep(.note-editor-content),
.ne-text :deep(.ProseMirror) {
	min-height: 100%;
}

.ne-text :deep(.ProseMirror) {
	outline: none;
}

.ne-text :deep(.ProseMirror > :first-child) {
	margin-top: 0;
}

.ne-text :deep(ul[data-type="taskList"]) {
	list-style: none;
	padding-inline-start: 0;
}

.ne-text :deep(li[data-type="taskItem"]) {
	display: flex;
	gap: 0.5em;
	align-items: flex-start;
	padding-inline-start: 0;
}

.ne-text :deep(li[data-type="taskItem"] > label) {
	flex: none;
	display: flex;
	align-items: center;
	height: 1.75em;
}

.ne-text :deep(li[data-type="taskItem"] > div) {
	flex: 1;
	min-width: 0;
}

.ne-text :deep(li > p),
.ne-text :deep(:where(td, th) > p) {
	margin-top: 0;
	margin-bottom: 0;
}

.ne-text :deep(:where(aside, div[data-callout])) {
	background: rgb(0 0 0 / 0.05);
	border-radius: 0.5rem;
	padding: 0.7rem 0.85rem;
}

.ne-text :deep(mark) {
	color: inherit;
	border-radius: 3px;
	padding: 0 0.1em;
}

.ne-plain {
	display: block;
	width: 100%;
	border: 0;
	outline: none;
	resize: none;
	background: none;
	font-family: inherit;
	line-height: 1.6;
}
</style>

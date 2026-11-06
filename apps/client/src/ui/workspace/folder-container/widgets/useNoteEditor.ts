import {
	computed,
	onBeforeUnmount,
	ref,
	toValue,
	watch,
	type MaybeRefOrGetter,
} from 'vue'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { toggle_task } from '@/services/text/tasks'
import { armNoteKeyboardFocus } from '../noteKeyboardFocus'
import { rememberEditPoint } from './editPoint'
import { loadedNoteRenderer, loadNoteEditor, loadNoteRenderer, taskBoxLabel } from './noteRenderer'
import { useEditingNoteId } from './useEditingNoteId'

const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_SLOP_PX = 28

export function useNoteEditor(
	widgetId: MaybeRefOrGetter<string>,
	fileName?: MaybeRefOrGetter<string>,
	options?: {
		/** A text block: leaving it empty removes the file (a note stays, empty). */
		isText?: MaybeRefOrGetter<boolean>
	},
) {
	const { editingNoteId, onNoteEditExit } = useEditingNoteId()
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()
	const text = ref('')
	const previewHtml = ref('')
	const isLoaded = ref(false)
	let loadPromise: Promise<void> | null = null
	/** The text the file holds as far as this note knows (read or written); null: not known. */
	let persisted: string | null = null

	let lastTapAt = 0
	let lastTapX = 0
	let lastTapY = 0
	let tapPointerId: number | null = null
	let tapStartX = 0
	let tapStartY = 0

	const isEditing = computed(() => editingNoteId.value === toValue(widgetId))
	const isMarkdown = computed(() => (toValue(fileName) ?? '').endsWith('.md'))
	/** A task box in the preview ticks the task, where the folder can be written to. */
	const canToggleTasks = computed(() => workspace.value?.can_write !== false)

	// The renderer may still be loading: only the latest refresh lands.
	let previewRun = 0
	function refreshPreview() {
		const run = ++previewRun
		if (!isMarkdown.value) {
			previewHtml.value = ''
			return
		}
		const render = loadedNoteRenderer()
		if (render) {
			previewHtml.value = render(text.value)
			return
		}
		void loadNoteRenderer().then((loaded) => {
			if (run === previewRun) previewHtml.value = loaded(text.value)
		})
	}

	/** Loads note content on first demand (visibility or edit), deduped via the session cache. */
	function ensureLoaded(): Promise<void> {
		if (isLoaded.value) return Promise.resolve()
		// The renderer's chunk loads alongside the first note's content.
		if (isMarkdown.value) void loadNoteRenderer()
		if (!loadPromise) {
			const id = toValue(widgetId)
			loadPromise = requireWorkspace().content_caches.notes
				.get(id, () => requireWorkspace().read_note_content(id))
				.then((content) => {
					// Don't clobber user input if editing started while loading,
					// or if we already treat the session as loaded (create-from-menu).
					if (!isEditing.value && !isLoaded.value) {
						text.value = content
					}
					persisted = content
					isLoaded.value = true
					refreshPreview()
				})
				.finally(() => {
					loadPromise = null
				})
		}
		return loadPromise
	}

	/** Writes the text, unless the file already holds it: leaving a note unchanged writes nothing. */
	async function save() {
		const ws = requireWorkspace()
		if (!ws.can_write) return
		const id = toValue(widgetId)
		const content = text.value
		if (content === persisted) return
		await ws.save_note_content(id, content)
		persisted = content
		// Capture content before await — ensureLoaded can clobber text.value
		// with a stale empty cache entry while save_note_content is in flight.
		ws.content_caches.notes.set(id, content)
		text.value = content
	}

	/**
	 * Ticks or unticks a task from the preview: one character of the file
	 * changes (toggle_task), the rest stays byte for byte.
	 */
	async function toggleTask(index: number, checked: boolean) {
		if (!canToggleTasks.value || isEditing.value) return
		await ensureLoaded()
		const next = toggle_task(text.value, index, checked)
		if (next !== null && next !== text.value) {
			text.value = next
			refreshPreview()
			await save()
		} else {
			refreshPreview()
		}
	}

	function exitEdit() {
		if (editingNoteId.value === toValue(widgetId)) {
			editingNoteId.value = null
		}
	}

	async function startEdit() {
		if (workspace.value?.can_write === false) return
		// Content must be loaded before editing, otherwise saving would overwrite the file with empty text.
		// A markdown note opens in the rich editor: its chunk loads alongside.
		await Promise.all([
			ensureLoaded(),
			isMarkdown.value ? loadNoteEditor().catch(() => undefined) : undefined,
		])
		editingNoteId.value = toValue(widgetId)
	}

	/** Enter edit from a user gesture; arm soft keyboard before any await. */
	function beginEditFromGesture(point?: { x: number; y: number }) {
		if (isEditing.value) return
		if (point) rememberEditPoint(point.x, point.y)
		window.getSelection()?.removeAllRanges()
		armNoteKeyboardFocus()
		void startEdit()
	}

	function onPointerDown(event: PointerEvent) {
		// Only clear selection while idle. Avoid mousedown preventDefault —
		// it fights interactjs pointer tracking in WKWebView.
		if (isEditing.value) {
			return
		}
		window.getSelection()?.removeAllRanges()

		// Track tap start for touch/pen double-tap (mobile has no reliable dblclick).
		if (event.pointerType === 'mouse') return
		tapPointerId = event.pointerId
		tapStartX = event.clientX
		tapStartY = event.clientY
	}

	function onPointerUp(event: PointerEvent) {
		if (isEditing.value) return
		if (event.pointerType === 'mouse') return
		if (tapPointerId !== event.pointerId) return
		tapPointerId = null
		// Two quick taps on task boxes tick tasks; they do not open the note.
		if (taskBoxLabel(event.target)) {
			lastTapAt = 0
			return
		}

		const movedX = event.clientX - tapStartX
		const movedY = event.clientY - tapStartY
		if (movedX * movedX + movedY * movedY > DOUBLE_TAP_SLOP_PX * DOUBLE_TAP_SLOP_PX) {
			lastTapAt = 0
			return
		}

		const now = performance.now()
		const dt = now - lastTapAt
		const dx = event.clientX - lastTapX
		const dy = event.clientY - lastTapY
		const near =
			dx * dx + dy * dy <= DOUBLE_TAP_SLOP_PX * DOUBLE_TAP_SLOP_PX

		if (lastTapAt > 0 && dt <= DOUBLE_TAP_MS && near) {
			lastTapAt = 0
			event.preventDefault()
			event.stopPropagation()
			beginEditFromGesture({ x: event.clientX, y: event.clientY })
			return
		}

		lastTapAt = now
		lastTapX = event.clientX
		lastTapY = event.clientY
	}

	function onPointerCancel() {
		tapPointerId = null
		lastTapAt = 0
	}

	function onSelectStart(event: Event) {
		if (!isEditing.value) {
			event.preventDefault()
		}
	}

	function onDragStart(event: DragEvent) {
		if (!isEditing.value) {
			event.preventDefault()
		}
	}

	function onDblClick(event: MouseEvent) {
		if (isEditing.value) return
		if (taskBoxLabel(event.target)) {
			event.stopPropagation()
			return
		}
		event.preventDefault()
		event.stopPropagation()
		beginEditFromGesture({ x: event.clientX, y: event.clientY })
	}

	function onBlur() {
		exitEdit()
	}

	// Save-on-exit runs through the view-level watcher in useEditingNoteId
	// (one watcher per view instead of one per note widget).
	let unregisterExit: (() => void) | null = null
	let unsubscribeCache: (() => void) | null = null
	watch(() => toValue(widgetId), (id) => {
		unregisterExit?.()
		// One handler per id (a second onNoteEditExit would replace this one),
		// so the empty-text check lives here, after the save.
		unregisterExit = onNoteEditExit(id, async () => {
			await save()
			if (toValue(options?.isText) === true && text.value.trim() === '') {
				const ws = requireWorkspace()
				if (ws.can_write) {
					await ws.remove(id)
					return
				}
			}
			refreshPreview()
		})
		// External edits (another device/instance) invalidate the session
		// cache — reload the note. Skipped while editing: reloading would
		// clobber typed text, and skipped when never loaded: off-screen
		// notes must not fetch on every event
		unsubscribeCache?.()
		unsubscribeCache = requireWorkspace().content_caches.notes.subscribe(id, (value) => {
			if (value !== undefined || isEditing.value || !isLoaded.value) return
			isLoaded.value = false
			void ensureLoaded()
		})
	}, { immediate: true })

	watch(isMarkdown, () => {
		if (isLoaded.value) refreshPreview()
	})

	// When edit starts from the create menu, ensureLoaded was never called
	// (preview never became visible). Mark loaded so a post-exit ensureLoaded
	// does not overwrite typed text with the empty create-time cache entry.
	watch(isEditing, (editing) => {
		if (editing && !isLoaded.value) {
			isLoaded.value = true
		}
	})

	onBeforeUnmount(() => {
		unregisterExit?.()
		unsubscribeCache?.()
		if (editingNoteId.value === toValue(widgetId)) {
			// Save, but keep editingNoteId — list reconciles can remount the
			// same note in the same tick; clearing here aborts edit immediately.
			void save()
		}
	})

	return {
		text,
		isEditing,
		isMarkdown,
		previewHtml,
		canToggleTasks,
		toggleTask,
		ensureLoaded,
		onPointerDown,
		onPointerUp,
		onPointerCancel,
		onSelectStart,
		onDragStart,
		onDblClick,
		onBlur,
		startEdit,
		exitEdit,
		save,
	}
}

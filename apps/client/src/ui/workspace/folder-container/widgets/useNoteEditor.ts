import {
	computed,
	onBeforeUnmount,
	ref,
	toValue,
	watch,
	type MaybeRefOrGetter,
} from 'vue'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { armNoteKeyboardFocus } from '../noteKeyboardFocus'
import { parseNoteMarkdown } from './markdown'
import { useEditingNoteId } from './useEditingNoteId'

const DOUBLE_TAP_MS = 320
const DOUBLE_TAP_SLOP_PX = 28

export function useNoteEditor(
	widgetId: MaybeRefOrGetter<string>,
	fileName?: MaybeRefOrGetter<string>,
) {
	const { editingNoteId, onNoteEditExit } = useEditingNoteId()
	const requireWorkspace = useRequireWorkspace()
	const workspace = useWorkspace()
	const text = ref('')
	const previewHtml = ref('')
	const isLoaded = ref(false)
	let loadPromise: Promise<void> | null = null

	let lastTapAt = 0
	let lastTapX = 0
	let lastTapY = 0
	let tapPointerId: number | null = null
	let tapStartX = 0
	let tapStartY = 0

	const isEditing = computed(() => editingNoteId.value === toValue(widgetId))
	const isMarkdown = computed(() => (toValue(fileName) ?? '').endsWith('.md'))

	function refreshPreview() {
		previewHtml.value = isMarkdown.value
			? parseNoteMarkdown(text.value)
			: ''
	}

	/** Loads note content on first demand (visibility or edit), deduped via the session cache. */
	function ensureLoaded(): Promise<void> {
		if (isLoaded.value) return Promise.resolve()
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
					isLoaded.value = true
					refreshPreview()
				})
				.finally(() => {
					loadPromise = null
				})
		}
		return loadPromise
	}

	async function save() {
		const ws = requireWorkspace()
		if (!ws.can_write) return
		const id = toValue(widgetId)
		const content = text.value
		await ws.save_note_content(id, content)
		// Capture content before await — ensureLoaded can clobber text.value
		// with a stale empty cache entry while save_note_content is in flight.
		ws.content_caches.notes.set(id, content)
		text.value = content
	}

	function exitEdit() {
		if (editingNoteId.value === toValue(widgetId)) {
			editingNoteId.value = null
		}
	}

	async function startEdit() {
		if (workspace.value?.can_write === false) return
		// Content must be loaded before editing, otherwise saving would overwrite the file with empty text.
		await ensureLoaded()
		editingNoteId.value = toValue(widgetId)
	}

	/** Enter edit from a user gesture; arm soft keyboard before any await. */
	function beginEditFromGesture() {
		if (isEditing.value) return
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
			beginEditFromGesture()
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
		event.preventDefault()
		event.stopPropagation()
		beginEditFromGesture()
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
		unregisterExit = onNoteEditExit(id, async () => {
			await save()
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

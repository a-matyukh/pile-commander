import { ref, type ComputedRef, type Ref } from 'vue'
import type { Position } from '@/domain/Widget'
import { useBoardPlacement } from './board/boardShapePlacement'
import { armNoteKeyboardFocus } from './noteKeyboardFocus'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

type PanePointerEvent = Pick<MouseEvent, 'clientX' | 'clientY'> & {
	target?: EventTarget | null
}

type UseFolderPaneActionsOptions = {
	folderId: ComputedRef<string>
	editingNoteId: Ref<string | null>
	/** Maps a mouse/pointer event to pane coordinates (board scroll offset / flow projection). */
	resolvePosition: (event: PanePointerEvent) => Position | null
	/** Clicks inside this selector don't exit note editing. */
	noteSelector?: string
}

/**
 * Pane-level interactions shared by Board and Canvas:
 * note creation on dblclick, folder creation on Shift+dblclick,
 * shape placement on click, click-outside note editing exit,
 * and context menu positioning.
 */
export function useFolderPaneActions(options: UseFolderPaneActionsOptions) {
	const { boardPlacementTemplate, clearBoardPlacement } = useBoardPlacement()
	const workspace = useWorkspace()
	const contextMenuPosition = ref<Position | null>(null)
	const noteSelector = options.noteSelector ?? '.note-widget'

	/** Remember where the user pressed — needed for mobile long-press menus that
	 *  open without a reliable `contextmenu` event carrying coordinates. */
	function rememberContextMenuPosition(event: PanePointerEvent) {
		const position = options.resolvePosition(event)
		if (position) {
			contextMenuPosition.value = position
		}
	}

	async function createNoteAt(event: MouseEvent) {
		const ws = workspace.value
		if (!ws || !ws.can_write) return

		const position = options.resolvePosition(event)
		if (!position) return

		// Sync with the dblclick gesture so touch devices can open the soft keyboard.
		armNoteKeyboardFocus()
		const note_id = await ws.create_note(options.folderId.value, position)
		if (note_id) {
			options.editingNoteId.value = note_id
		}
	}

	async function createFolderAt(event: MouseEvent) {
		const ws = workspace.value
		if (!ws || !ws.can_write) return

		const position = options.resolvePosition(event)
		if (!position) return

		await ws.create_folder(options.folderId.value, position)
	}

	async function onPaneClick(event: MouseEvent) {
		const ws = workspace.value
		if (!ws) return

		const template = boardPlacementTemplate.value
		if (template && ws.can_write) {
			const position = options.resolvePosition(event)
			if (position) {
				await ws.create_shape(options.folderId.value, template, position)
				clearBoardPlacement()
			}
			return
		}

		// Empty-pane click: drop the selection and leave touch Select mode
		// so the header Deselect control does not linger with nothing selected.
		ws.exit_selection_mode()

		if (!options.editingNoteId.value) return
		if ((event.target as HTMLElement).closest(noteSelector)) return
		options.editingNoteId.value = null
	}

	function onPaneContextMenu(event: MouseEvent) {
		rememberContextMenuPosition(event)
	}

	return {
		boardPlacementTemplate,
		clearBoardPlacement,
		contextMenuPosition,
		rememberContextMenuPosition,
		createNoteAt,
		createFolderAt,
		onPaneClick,
		onPaneContextMenu,
	}
}

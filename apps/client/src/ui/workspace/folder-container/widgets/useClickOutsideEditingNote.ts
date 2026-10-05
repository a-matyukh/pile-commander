import type { Ref } from 'vue'

/** Pass the view's own `editingNoteId` ref — inject cannot see a provide from the same setup. */
export function useClickOutsideEditingNote(
	noteSelector: string,
	editingNoteId: Ref<string | null>,
) {
	function onSectionClick(event: MouseEvent) {
		if (!editingNoteId.value) return
		if (!(event.target instanceof HTMLElement)) return
		if (event.target.closest(noteSelector)) return
		editingNoteId.value = null
	}

	return { onSectionClick }
}

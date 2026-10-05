import { reactive } from 'vue'
import type { ClipboardMode, WorkspaceStore } from '@/domain/Store'

export type EntryClipboard = {
	mode: ClipboardMode
	/**
	 * Store the entries were cut/copied from; cross-store paste reads content
	 * through its file manager. A direct reference (not a registry key) so the
	 * identity survives fullscreen → window adoption.
	 */
	source_store: WorkspaceStore
	source_folder_id: string
	entry_ids: string[]
} | null

/**
 * App-wide entry clipboard: cut/copy on any surface (desktop board, workspace
 * window) is pasteable in any other store. Lives outside the stores so it
 * survives their disposal (a disposed source's file manager still reads).
 */
const state = reactive<{ value: EntryClipboard }>({ value: null })

export const entry_clipboard = {
	get current(): EntryClipboard {
		return state.value
	},
	set(clip: NonNullable<EntryClipboard>): void {
		state.value = clip
	},
	clear(): void {
		state.value = null
	},
}

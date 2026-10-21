import { reactive } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { NameEntry } from '@/services/ai/suggestName'

export type BulkRenameRequest = {
	open: boolean
	workspace: WorkspaceStore | null
	folder_id: string
	entries: NameEntry[]
	/** bumps on every open, so the dialog restarts for a new selection */
	run: number
}

/** The one bulk rename dialog (`BulkRenameDialog.vue`, mounted in the app root). */
export const bulk_rename_request: BulkRenameRequest = reactive({
	open: false,
	workspace: null,
	folder_id: '',
	entries: [],
	run: 0,
})

export function open_bulk_rename(workspace: WorkspaceStore, folder_id: string, entries: NameEntry[]) {
	if (!entries.length) return
	bulk_rename_request.workspace = workspace
	bulk_rename_request.folder_id = folder_id
	bulk_rename_request.entries = entries
	bulk_rename_request.run++
	bulk_rename_request.open = true
}

export function close_bulk_rename() {
	bulk_rename_request.open = false
}

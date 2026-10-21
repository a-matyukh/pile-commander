import { reactive } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { Position } from '@/domain/Widget'
import type { SummaryEntry } from '@/services/ai/summarize'

export type SummaryRequest = {
	open: boolean
	workspace: WorkspaceStore | null
	folder_id: string
	board_name: string
	entries: SummaryEntry[]
	/** where the summary note goes; null lets the folder place it */
	position: Position | null
	/** bumps on every open, so the dialog restarts */
	run: number
}

/** The one summary dialog (`SummaryDialog.vue`, mounted in the app root). */
export const summary_request: SummaryRequest = reactive({
	open: false,
	workspace: null,
	folder_id: '',
	board_name: '',
	entries: [],
	position: null,
	run: 0,
})

export function open_summary(input: {
	workspace: WorkspaceStore
	folder_id: string
	board_name: string
	entries: SummaryEntry[]
	position: Position | null
}) {
	if (!input.entries.length) return
	Object.assign(summary_request, input)
	summary_request.run++
	summary_request.open = true
}

export function close_summary() {
	summary_request.open = false
}

import { reactive } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import { close_proposal, type ProposalPreview } from '@/services/mcp/propose'
import type { NameEntry } from '@/services/ai/suggestName'

export type BulkRenameRequest = {
	open: boolean
	workspace: WorkspaceStore | null
	folder_id: string
	entries: NameEntry[]
	/** bumps on every open, so the dialog restarts for a new selection */
	run: number
	/** `suggest` asks the model. `proposal` shows names an agent already chose. */
	source: 'suggest' | 'proposal'
	client_name: string
	reason: string
	proposal_id: string
	/** entry id → the agent's `to` name. Empty for the suggest path. */
	proposal_to: Record<string, string>
}

/** The one bulk rename dialog (`BulkRenameDialog.vue`, mounted in the app root). */
export const bulk_rename_request: BulkRenameRequest = reactive({
	open: false,
	workspace: null,
	folder_id: '',
	entries: [],
	run: 0,
	source: 'suggest',
	client_name: '',
	reason: '',
	proposal_id: '',
	proposal_to: {},
})

/** True while Suggest names holds the one dialog. An agent proposal waits. */
export function suggest_dialog_open(): boolean {
	return bulk_rename_request.open && bulk_rename_request.source === 'suggest'
}

export function open_bulk_rename(workspace: WorkspaceStore, folder_id: string, entries: NameEntry[]) {
	if (!entries.length) return
	if (bulk_rename_request.open && bulk_rename_request.source === 'proposal') {
		close_proposal(bulk_rename_request.proposal_id)
	}
	bulk_rename_request.source = 'suggest'
	bulk_rename_request.client_name = ''
	bulk_rename_request.reason = ''
	bulk_rename_request.proposal_id = ''
	bulk_rename_request.proposal_to = {}
	bulk_rename_request.workspace = workspace
	bulk_rename_request.folder_id = folder_id
	bulk_rename_request.entries = entries
	bulk_rename_request.run++
	bulk_rename_request.open = true
}

/** Agent preview. Rows are ready immediately; the dialog does not ask the model. */
export function open_proposed_rename(workspace: WorkspaceStore, preview: ProposalPreview) {
	if (!preview.rows.length) return
	bulk_rename_request.source = 'proposal'
	bulk_rename_request.client_name = preview.client_name
	bulk_rename_request.reason = preview.reason
	bulk_rename_request.proposal_id = preview.proposal_id
	bulk_rename_request.proposal_to = Object.fromEntries(preview.rows.map(row => [row.id, row.to]))
	bulk_rename_request.workspace = workspace
	bulk_rename_request.folder_id = preview.folder_id
	bulk_rename_request.entries = preview.rows.map(row => ({ id: row.id, name: row.name, type: row.type }))
	bulk_rename_request.run++
	bulk_rename_request.open = true
}

export function close_bulk_rename() {
	bulk_rename_request.open = false
}

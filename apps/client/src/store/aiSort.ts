import { reactive } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { SummaryEntry } from '@/services/ai/summarize'
import { close_proposal } from '@/services/mcp/proposal'
import type { MovePreview } from '@/services/mcp/propose_move'
import { close_agent_previews, register_ai_session_kind } from './aiSession'

export type SortRow = {
	id: string
	name: string
	type: 'file' | 'folder'
	checked: boolean
	status: 'ready' | 'moved' | 'failed'
	error: string | null
}

export type SortGroup = {
	key: string
	/** The folder as proposed. */
	to: string
	/** The name it will get: a new folder's can be edited in the preview. */
	name: string
	/** The folder already there, or null for one to make. */
	existing_id: string | null
	rows: SortRow[]
}

export type SortSession = {
	open: boolean
	/** `agent` shows what an agent proposed over MCP; `model` asks the app's own model. */
	source: 'agent' | 'model'
	workspace: WorkspaceStore | null
	folder_id: string
	/** `model`: the folder's name and what is read. */
	board_name: string
	entries: SummaryEntry[]
	groups: SortGroup[]
	client_name: string
	reason: string
	proposal_id: string
	/** Bumps on every open, so the preview restarts. */
	run: number
}

/** The one sorting preview (`SortDialog.vue`, mounted in the app root). */
export const sort_session: SortSession = reactive({
	open: false,
	source: 'agent',
	workspace: null,
	folder_id: '',
	board_name: '',
	entries: [],
	groups: [],
	client_name: '',
	reason: '',
	proposal_id: '',
	run: 0,
})

register_ai_session_kind({
	own_open: () => sort_session.open && sort_session.source === 'model',
	close_agent_preview() {
		if (!sort_session.open || sort_session.source !== 'agent') return
		close_proposal(sort_session.proposal_id)
		sort_session.open = false
	},
})

/** An agent's moves, grouped by folder, every one checked, nothing moved yet. */
export function open_proposed_move(workspace: WorkspaceStore, preview: MovePreview) {
	if (!preview.groups.length) return
	sort_session.source = 'agent'
	sort_session.workspace = workspace
	sort_session.folder_id = preview.folder_id
	sort_session.board_name = ''
	sort_session.entries = []
	sort_session.client_name = preview.client_name
	sort_session.reason = preview.reason
	sort_session.proposal_id = preview.proposal_id
	sort_session.groups = preview.groups.map((group, index) => ({
		key: `${preview.proposal_id}:${index}`,
		to: group.to,
		name: group.to,
		existing_id: group.existing_id,
		rows: group.entries.map(entry => ({ ...entry, checked: true, status: 'ready', error: null })),
	}))
	sort_session.run++
	sort_session.open = true
}

/**
 * "Sort into folders" from a menu: the app's own model, nothing asked yet.
 * The person's action wins over an agent preview that waits.
 */
export function open_sort(input: {
	workspace: WorkspaceStore
	folder_id: string
	board_name: string
	entries: SummaryEntry[]
}) {
	if (!input.entries.length) return
	close_agent_previews()
	sort_session.source = 'model'
	sort_session.workspace = input.workspace
	sort_session.folder_id = input.folder_id
	sort_session.board_name = input.board_name
	sort_session.entries = input.entries
	sort_session.client_name = ''
	sort_session.reason = ''
	sort_session.proposal_id = ''
	sort_session.groups = []
	sort_session.run++
	sort_session.open = true
}

export function close_sort() {
	sort_session.open = false
}

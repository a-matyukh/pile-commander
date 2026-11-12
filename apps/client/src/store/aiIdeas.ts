import { reactive } from 'vue'
import type { WorkspaceStore } from '@/domain/Store'
import type { Position } from '@/domain/Widget'
import { close_proposal } from '@/services/mcp/proposal'
import type { CreatePreview } from '@/services/mcp/propose_create'
import { register_ai_session_kind } from './aiSession'

export type IdeaRow = {
	key: string
	/** Ends in `.md`: the name asked for, before a taken one is numbered. */
	name: string
	/** Markdown, as proposed. */
	text: string
	checked: boolean
	/** Where it goes on a board; null until placed, or when the folder places it. */
	position: Position | null
	status: 'ready' | 'created' | 'failed'
	error: string | null
}

export type IdeasSession = {
	open: boolean
	/** `agent` shows what an agent proposed over MCP. */
	source: 'agent'
	workspace: WorkspaceStore | null
	folder_id: string
	rows: IdeaRow[]
	client_name: string
	reason: string
	proposal_id: string
	/** Bumps on every open, so the preview restarts. */
	run: number
}

/** The one new-notes preview (`IdeasDialog.vue`, mounted in the app root). */
export const ideas_session: IdeasSession = reactive({
	open: false,
	source: 'agent',
	workspace: null,
	folder_id: '',
	rows: [],
	client_name: '',
	reason: '',
	proposal_id: '',
	run: 0,
})

register_ai_session_kind({
	own_open: () => false,
	close_agent_preview() {
		if (!ideas_session.open || ideas_session.source !== 'agent') return
		close_proposal(ideas_session.proposal_id)
		ideas_session.open = false
	},
})

/** An agent's notes, every one checked, nothing written yet. */
export function open_proposed_create(workspace: WorkspaceStore, preview: CreatePreview) {
	if (!preview.files.length) return
	ideas_session.source = 'agent'
	ideas_session.workspace = workspace
	ideas_session.folder_id = preview.folder_id
	ideas_session.client_name = preview.client_name
	ideas_session.reason = preview.reason
	ideas_session.proposal_id = preview.proposal_id
	ideas_session.rows = preview.files.map((file, index) => ({
		key: `${preview.proposal_id}:${index}`,
		name: file.name,
		text: file.text,
		checked: true,
		position: null,
		status: 'ready',
		error: null,
	}))
	ideas_session.run++
	ideas_session.open = true
}

export function close_ideas() {
	ideas_session.open = false
}

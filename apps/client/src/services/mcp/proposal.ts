import {
	McpError,
	type FolderAddress,
	type GetProposalResult,
	type McpContext,
	type ProposalBody,
	type ProposalKind,
	type ProposalStatus,
} from './types'

/**
 * The one slot an agent's preview holds, whatever it proposes. A second
 * proposal while one is pending is `busy`, and so is one while the person
 * has an AI session of their own open. Nothing here writes: each kind
 * writes what the person confirmed, and the MCP server only registers the
 * functions built on this.
 */

/** `entries_name_check`: one segment, at most 255 characters. */
export const NAME_CHAR_LIMIT = 255
export const REASON_CHAR_LIMIT = 500

export type HeldProposal = {
	readonly id: string
	readonly kind: ProposalKind
	status: ProposalStatus
	/** Confirm ran: closing the preview then means `accepted`. */
	confirmed: boolean
	readonly client_name: string
	readonly reason: string
	readonly folder: FolderAddress
	/** The kind's rows as `get_proposal` shows them. */
	view(): ProposalBody
	/** Closed before confirm: every row is skipped. */
	skip_rows(): void
}

let current: HeldProposal | null = null

export function held_proposal(): HeldProposal | null {
	return current
}

/**
 * Holds the slot for `proposal` while its preview opens. A preview that
 * fails to open gives the slot back to whatever held it before.
 */
export async function hold_proposal(proposal: HeldProposal, open: () => void | Promise<void>): Promise<void> {
	const previous = current
	current = proposal
	try {
		await open()
	} catch (error) {
		if (current === proposal) current = previous
		throw error
	}
}

export function get_proposal(ctx: McpContext, proposal_id: string): GetProposalResult {
	require_enabled(ctx)
	if (!current || current.id !== proposal_id) throw new McpError('proposal_not_found')
	return {
		proposal_id: current.id,
		status: current.status,
		client_name: current.client_name,
		reason: current.reason,
		folder: current.folder,
		...current.view(),
	}
}

/** The preview closed. Confirmed → `accepted`. Not confirmed → `dismissed`, nothing written. */
export function close_proposal(id: string) {
	const proposal = current
	if (!proposal || proposal.id !== id || proposal.status !== 'pending') return
	if (proposal.confirmed) {
		proposal.status = 'accepted'
		return
	}
	proposal.status = 'dismissed'
	proposal.skip_rows()
}

/** Access off, or the app is done with the slot. The next id is `proposal_not_found`. */
export function forget_proposals() {
	current = null
}

/** `app_busy`: the person's own AI session holds the slot. No proposal id then. */
export function refuse_if_busy(app_busy: () => boolean) {
	if (current?.status === 'pending') throw new McpError('busy', current.id)
	if (app_busy()) throw new McpError('busy')
}

export function require_enabled(ctx: McpContext) {
	if (ctx.enabled) return
	current = null
	throw new McpError('mcp_disabled')
}

export function require_reason(reason: string): string {
	const text = reason.trim()
	if (text === '' || [...text].length > REASON_CHAR_LIMIT) throw new McpError('bad_request')
	return text
}

const CONTROL = /[\u0000-\u001f\u007f]/

/** One name segment the file systems take: no path, no control characters. */
export function require_file_name(name: string) {
	if (
		name === ''
		|| name === '.'
		|| name === '..'
		|| name.includes('/')
		|| name.includes('\\')
		|| CONTROL.test(name)
		|| [...name].length > NAME_CHAR_LIMIT
	) throw new McpError('bad_request')
}

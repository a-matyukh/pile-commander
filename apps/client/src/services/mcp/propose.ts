import { planned_names, type BulkRow } from '@/services/ai/bulkRename'
import { name_is_hidden } from './path'
import {
	hold_proposal,
	held_proposal,
	refuse_if_busy,
	require_enabled,
	require_file_name,
	require_reason,
	type HeldProposal,
} from './proposal'
import { granted_path, load_granted_folder } from './read'
import { McpError, type FolderAddress, type McpContext, type RenameRowResult } from './types'

/**
 * Rename proposals for a local agent. Nothing is written until the person
 * confirms. The slot, `get_proposal` and closing are shared with the other
 * kinds (`proposal.ts`); the MCP server only registers these functions.
 */

export { NAME_CHAR_LIMIT, REASON_CHAR_LIMIT, close_proposal, forget_proposals, get_proposal } from './proposal'
export type { GetProposalResult } from './types'

export const RENAME_ROW_LIMIT = 100

export type ProposeRenameArgs = {
	folder: FolderAddress
	reason: string
	renames: { name: string; to: string }[]
}

export type ProposeRenameResult = {
	proposal_id: string
	status: 'pending'
}

export type ProposalRowResult = RenameRowResult

export type ProposalEntry = {
	id: string
	name: string
	type: 'file' | 'folder'
	to: string
}

/** What the dialog opens. The tool does not know about Vue. */
export type ProposalPreview = {
	proposal_id: string
	client_name: string
	reason: string
	drive_id: string
	root_id: string
	folder_id: string
	rows: ProposalEntry[]
}

export type ProposalOpener = (preview: ProposalPreview) => void | Promise<void>

export type ProposalDecision = {
	name: string
	checked: boolean
	written_name: string
}

type StoredRow = {
	entry_id: string
	name: string
	to: string
	outcome: ProposalRowResult['outcome']
	written_name?: string
	error?: string
}

type RenameProposal = HeldProposal & {
	readonly kind: 'rename'
	rows: StoredRow[]
}

/** The held proposal when it is this rename. */
function held_rename(id: string): RenameProposal | null {
	const proposal = held_proposal()
	return proposal && proposal.id === id && proposal.kind === 'rename' ? proposal as RenameProposal : null
}

/** Rows the agent dialog shows: already decided, checkboxes on, no model call. */
export function ready_proposal_rows(entries: readonly ProposalEntry[]): BulkRow[] {
	return entries.map(entry => ({
		entry: { id: entry.id, name: entry.name, type: entry.type },
		status: 'ready',
		suggestion: entry.to,
		reason: null,
		checked: true,
	}))
}

/**
 * What confirm will write. Unchecked rows and names that do not change are
 * left out. Collisions get the same ` (1)` suffix as the suggest dialog.
 */
export function proposal_decisions(
	rows: readonly BulkRow[],
	sibling_names: Iterable<string>,
): ProposalDecision[] {
	const planned = planned_names(rows, sibling_names)
	return rows.map(row => {
		const written_name = planned.get(row.entry.id) ?? row.suggestion ?? row.entry.name
		return {
			name: row.entry.name,
			checked: planned.has(row.entry.id) && written_name !== row.entry.name,
			written_name,
		}
	})
}

export async function propose_rename(
	ctx: McpContext,
	args: ProposeRenameArgs,
	client_name: string,
	open: ProposalOpener,
	/** The person's own AI session holds the one slot. No proposal id in that case. */
	dialog_busy: () => boolean = () => false,
): Promise<ProposeRenameResult> {
	require_enabled(ctx)
	refuse_if_busy(dialog_busy)
	const reason = require_reason(args.reason)
	require_batch(args.renames, ctx.show_hidden)
	const loaded = await load_granted_folder(ctx, args.folder)
	refuse_if_busy(dialog_busy)
	const rows = match_children(loaded.data.children ?? [], args.renames)
	for (const row of rows) {
		const relative = loaded.folder.path === '' ? row.name : `${loaded.folder.path}/${row.name}`
		await granted_path(ctx, loaded.folder.drive_id, loaded.folder.root_id, relative)
	}
	refuse_if_busy(dialog_busy)
	const proposal: RenameProposal = {
		id: crypto.randomUUID(),
		kind: 'rename',
		status: 'pending',
		confirmed: false,
		client_name,
		reason,
		folder: loaded.folder,
		rows: rows.map(row => ({
			entry_id: row.id,
			name: row.name,
			to: row.to,
			outcome: 'pending',
		})),
		view: () => ({ kind: 'rename', rows: public_rows(proposal) }),
		skip_rows: () => {
			for (const row of proposal.rows) row.outcome = 'skipped'
		},
	}
	await hold_proposal(proposal, () => open({
		proposal_id: proposal.id,
		client_name,
		reason,
		drive_id: loaded.folder.drive_id,
		root_id: loaded.folder.root_id,
		folder_id: loaded.id,
		rows,
	}))
	return { proposal_id: proposal.id, status: 'pending' }
}

/**
 * Writes the checked rows. Status stays `pending` until `close_proposal`:
 * a dialog that is still showing failures has not finished.
 * `rename` returns an error string, or null when the new name is in place.
 */
export async function confirm_proposal(
	id: string,
	decisions: readonly ProposalDecision[],
	rename: (entry_id: string, name: string) => Promise<string | null>,
): Promise<ProposalRowResult[]> {
	const proposal = held_rename(id)
	if (!proposal || proposal.status !== 'pending' || proposal.confirmed) {
		return proposal ? public_rows(proposal) : []
	}
	proposal.confirmed = true
	const by_name = new Map(decisions.map(decision => [decision.name, decision]))
	for (const row of proposal.rows) {
		if (held_proposal() !== proposal) break
		const decision = by_name.get(row.name)
		const written = decision?.written_name ?? row.to
		if (!decision?.checked || written === row.name) {
			row.outcome = 'skipped'
			continue
		}
		let error: string | null
		try {
			error = await rename(row.entry_id, written)
		} catch (caught) {
			error = caught instanceof Error ? caught.message : String(caught)
		}
		if (held_proposal() !== proposal) break
		if (error) {
			row.outcome = 'failed'
			row.error = error
		} else {
			row.outcome = 'renamed'
			row.written_name = written
		}
	}
	return public_rows(proposal)
}

function require_batch(renames: { name: string; to: string }[], show_hidden: boolean) {
	if (renames.length === 0 || renames.length > RENAME_ROW_LIMIT) throw new McpError('bad_request')
	const seen = new Set<string>()
	for (const row of renames) {
		require_file_name(row.name)
		require_file_name(row.to)
		if (name_is_hidden(row.name, show_hidden) || name_is_hidden(row.to, show_hidden)) {
			throw new McpError('not_allowed')
		}
		if (seen.has(row.name)) throw new McpError('bad_request')
		seen.add(row.name)
	}
}

function match_children(
	children: readonly { id: string; name: string; type: 'file' | 'folder' }[],
	renames: readonly { name: string; to: string }[],
): ProposalEntry[] {
	return renames.map(rename => {
		const child = children.find(entry => entry.name === rename.name)
		if (!child) throw new McpError('not_found')
		return { id: child.id, name: child.name, type: child.type, to: rename.to }
	})
}

function public_rows(proposal: RenameProposal): ProposalRowResult[] {
	return proposal.rows.map(row => {
		const result: ProposalRowResult = { name: row.name, to: row.to, outcome: row.outcome }
		if (row.outcome === 'renamed' && row.written_name) result.written_name = row.written_name
		if (row.outcome === 'failed' && row.error) result.error = row.error
		return result
	})
}

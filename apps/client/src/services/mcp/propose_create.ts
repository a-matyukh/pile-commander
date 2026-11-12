import { note_file_name } from '@/services/ai/newNotes'
import { name_is_hidden, relative_to_root } from './path'
import {
	hold_proposal,
	held_proposal,
	refuse_if_busy,
	require_enabled,
	require_file_name,
	require_reason,
	type HeldProposal,
} from './proposal'
import { granted_new_child, load_granted_folder } from './read'
import { McpError, TEXT_BYTE_LIMIT, type CreateRowResult, type FolderAddress, type McpContext } from './types'

/**
 * New notes a local agent proposes for one folder ("Generate ideas" from a
 * chat). Nothing is written until the person confirms; on a board the notes
 * show as cards to accept in place. The MCP server only registers these.
 */

export const CREATE_FILE_LIMIT = 20

export type ProposeCreateArgs = {
	folder: FolderAddress
	/** Shown in the preview. */
	reason: string
	/** `name`: one segment, `.md` or no extension. `text`: Markdown. */
	files: { name: string; text: string }[]
}

export type ProposeCreateResult = {
	proposal_id: string
	status: 'pending'
}

/** What the preview opens. Names end in `.md`; numbering a taken one is the preview's. */
export type CreatePreview = {
	proposal_id: string
	client_name: string
	reason: string
	drive_id: string
	root_id: string
	folder_id: string
	files: { name: string; text: string }[]
}

export type CreateOpener = (preview: CreatePreview) => void | Promise<void>

/** One confirmed note as the write reports it. No `error`: it exists. */
export type CreateOutcome = {
	id?: string
	written_name?: string
	error?: string
}

type StoredRow = {
	name: string
	text: string
	outcome: CreateRowResult['outcome']
	written_name?: string
	path?: string
	error?: string
}

type CreateProposal = HeldProposal & {
	readonly kind: 'create'
	readonly root_id: string
	rows: StoredRow[]
}

function held_create(id: string): CreateProposal | null {
	const proposal = held_proposal()
	return proposal && proposal.id === id && proposal.kind === 'create' ? proposal as CreateProposal : null
}

export async function propose_create(
	ctx: McpContext,
	args: ProposeCreateArgs,
	client_name: string,
	open: CreateOpener,
	/** The person's own AI session holds the one slot. No proposal id in that case. */
	dialog_busy: () => boolean = () => false,
): Promise<ProposeCreateResult> {
	require_enabled(ctx)
	refuse_if_busy(dialog_busy)
	const reason = require_reason(args.reason)
	const files = require_files(args.files, ctx.show_hidden)
	const loaded = await load_granted_folder(ctx, args.folder)
	for (const file of files) await granted_new_child(ctx, loaded.id, file.name)
	refuse_if_busy(dialog_busy)
	const proposal: CreateProposal = {
		id: crypto.randomUUID(),
		kind: 'create',
		status: 'pending',
		confirmed: false,
		client_name,
		reason,
		folder: loaded.folder,
		root_id: loaded.folder.root_id,
		rows: files.map(file => ({ name: file.name, text: file.text, outcome: 'pending' })),
		view: () => ({ kind: 'create', rows: public_rows(proposal) }),
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
		files,
	}))
	return { proposal_id: proposal.id, status: 'pending' }
}

/**
 * Writes the checked rows (`checked` follows the preview's order) through
 * `write`, which gets them in that order and answers one outcome each.
 * Status stays `pending` until `close_proposal`: a preview still showing
 * failures has not finished.
 */
export async function confirm_create(
	id: string,
	checked: readonly boolean[],
	write: (rows: readonly { index: number; name: string; text: string }[]) => Promise<CreateOutcome[]>,
): Promise<CreateRowResult[]> {
	const proposal = held_create(id)
	if (!proposal || proposal.status !== 'pending' || proposal.confirmed) {
		return proposal ? public_rows(proposal) : []
	}
	proposal.confirmed = true
	const chosen = proposal.rows.flatMap((row, index) => (checked[index] ? [{ index, name: row.name, text: row.text }] : []))
	proposal.rows.forEach((row, index) => {
		if (!checked[index]) row.outcome = 'skipped'
	})
	if (!chosen.length) return public_rows(proposal)
	let outcomes: CreateOutcome[]
	try {
		outcomes = await write(chosen)
	} catch (caught) {
		const error = caught instanceof Error ? caught.message : String(caught)
		outcomes = chosen.map(() => ({ error }))
	}
	if (held_proposal() !== proposal) return []
	chosen.forEach((row, at) => {
		const outcome = outcomes[at] ?? { error: 'The note was not created' }
		const stored = proposal.rows[row.index]!
		if (outcome.error) {
			stored.outcome = 'failed'
			stored.error = outcome.error
			return
		}
		stored.outcome = 'created'
		if (outcome.written_name) stored.written_name = outcome.written_name
		if (outcome.id) {
			try {
				stored.path = relative_to_root(proposal.root_id, outcome.id)
			} catch {
				// an id outside the root (never for a local note): no path to give
			}
		}
	})
	return public_rows(proposal)
}

function require_files(files: { name: string; text: string }[], show_hidden: boolean): { name: string; text: string }[] {
	if (files.length === 0 || files.length > CREATE_FILE_LIMIT) throw new McpError('bad_request')
	const encoder = new TextEncoder()
	return files.map((file) => {
		const name = note_file_name(file.name)
		if (name === null || name.toLowerCase() === '.md') throw new McpError('bad_request')
		require_file_name(name)
		if (name_is_hidden(name, show_hidden)) throw new McpError('not_allowed')
		if (encoder.encode(file.text).length > TEXT_BYTE_LIMIT) throw new McpError('too_large')
		return { name, text: file.text }
	})
}

function public_rows(proposal: CreateProposal): CreateRowResult[] {
	return proposal.rows.map((row) => {
		const result: CreateRowResult = { name: row.name, outcome: row.outcome }
		if (row.outcome === 'created') {
			if (row.written_name) result.written_name = row.written_name
			if (row.path) result.path = row.path
		}
		if (row.outcome === 'failed' && row.error) result.error = row.error
		return result
	})
}

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
import { granted_new_child, granted_path, load_granted_folder } from './read'
import { McpError, type FolderAddress, type McpContext, type MovedFolderResult, type MoveRowResult } from './types'

/**
 * Moves a local agent proposes for one folder ("Sort this folder" from a
 * chat): direct children into folders directly inside it, existing or new.
 * Nothing moves until the person confirms the preview. The MCP server only
 * registers these functions.
 */

export const MOVE_ROW_LIMIT = 200
export const NEW_FOLDER_LIMIT = 20

export type ProposeMoveArgs = {
	folder: FolderAddress
	/** Shown in the preview. */
	reason: string
	/** `to`: a folder name directly inside `folder`, existing or new. */
	moves: { name: string; to: string }[]
}

export type ProposeMoveResult = {
	proposal_id: string
	status: 'pending'
}

export type MoveEntry = { id: string; name: string; type: 'file' | 'folder' }

/** What the preview opens: the moves grouped by folder, in the order the agent named them. */
export type MovePreview = {
	proposal_id: string
	client_name: string
	reason: string
	drive_id: string
	root_id: string
	folder_id: string
	groups: { to: string; existing_id: string | null; entries: MoveEntry[] }[]
}

export type MoveOpener = (preview: MovePreview) => void | Promise<void>

/** What the person kept: per group, the name it gets (a new one may be renamed) and the items still checked. */
export type MoveDecision = { to: string; name: string; entry_ids: string[] }

/** What the write did: per decision, the folder; per entry id, its new id or an error. */
export type MoveWriteResult = {
	folders: ({ id: string; name: string; created: boolean } | { error: string } | null)[]
	moved: Map<string, { id: string } | { error: string }>
}

type StoredRow = {
	entry_id: string
	name: string
	to: string
	outcome: MoveRowResult['outcome']
	path?: string
	error?: string
}

type MoveProposal = HeldProposal & {
	readonly kind: 'move'
	readonly root_id: string
	rows: StoredRow[]
	folders: MovedFolderResult[]
}

function held_move(id: string): MoveProposal | null {
	const proposal = held_proposal()
	return proposal && proposal.id === id && proposal.kind === 'move' ? proposal as MoveProposal : null
}

const same = (a: string, b: string) => a.normalize('NFC').toLowerCase() === b.normalize('NFC').toLowerCase()

export async function propose_move(
	ctx: McpContext,
	args: ProposeMoveArgs,
	client_name: string,
	open: MoveOpener,
	/** The person's own AI session holds the one slot. No proposal id in that case. */
	dialog_busy: () => boolean = () => false,
): Promise<ProposeMoveResult> {
	require_enabled(ctx)
	refuse_if_busy(dialog_busy)
	const reason = require_reason(args.reason)
	require_moves(args.moves, ctx.show_hidden)
	const loaded = await load_granted_folder(ctx, args.folder)
	refuse_if_busy(dialog_busy)
	const children = (loaded.data.children ?? []).map(child => ({ id: child.id, name: child.name, type: child.type }))
	const prefix = loaded.folder.path === '' ? '' : `${loaded.folder.path}/`

	const groups = new Map<string, { to: string; existing_id: string | null; entries: MoveEntry[] }>()
	for (const move of args.moves) {
		const child = children.find(entry => entry.name === move.name)
		if (!child) throw new McpError('not_found')
		await granted_path(ctx, loaded.folder.drive_id, loaded.folder.root_id, `${prefix}${child.name}`)
		const target = children.find(entry => same(entry.name, move.to))
		if (target && target.type !== 'folder') throw new McpError('bad_request')
		const key = (target?.name ?? move.to).normalize('NFC').toLowerCase()
		let group = groups.get(key)
		if (!group) {
			if (!target) await granted_new_child(ctx, loaded.id, move.to)
			group = { to: target?.name ?? move.to, existing_id: target?.id ?? null, entries: [] }
			groups.set(key, group)
		}
		group.entries.push(child)
	}
	if ([...groups.values()].filter(group => !group.existing_id).length > NEW_FOLDER_LIMIT) throw new McpError('bad_request')
	refuse_if_busy(dialog_busy)

	const proposal: MoveProposal = {
		id: crypto.randomUUID(),
		kind: 'move',
		status: 'pending',
		confirmed: false,
		client_name,
		reason,
		folder: loaded.folder,
		root_id: loaded.folder.root_id,
		rows: [...groups.values()].flatMap(group => group.entries.map(entry => ({
			entry_id: entry.id,
			name: entry.name,
			to: group.to,
			outcome: 'pending' as const,
		}))),
		folders: [],
		view: () => ({ kind: 'move', rows: public_rows(proposal), folders: [...proposal.folders] }),
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
		groups: [...groups.values()],
	}))
	return { proposal_id: proposal.id, status: 'pending' }
}

/**
 * Writes what the person kept through `write` and records the outcome. A
 * row left out of every decision is skipped. Status stays `pending` until
 * `close_proposal`: a preview still showing failures has not finished.
 */
export async function confirm_move(
	id: string,
	decisions: readonly MoveDecision[],
	write: (decisions: readonly MoveDecision[]) => Promise<MoveWriteResult>,
): Promise<MoveRowResult[]> {
	const proposal = held_move(id)
	if (!proposal || proposal.status !== 'pending' || proposal.confirmed) {
		return proposal ? public_rows(proposal) : []
	}
	proposal.confirmed = true
	const kept = decisions.filter(decision => decision.entry_ids.length > 0)
	const chosen = new Set(kept.flatMap(decision => decision.entry_ids))
	for (const row of proposal.rows) {
		if (!chosen.has(row.entry_id)) row.outcome = 'skipped'
	}
	if (!kept.length) return public_rows(proposal)
	let result: MoveWriteResult
	try {
		result = await write(kept)
	} catch (caught) {
		const error = caught instanceof Error ? caught.message : String(caught)
		result = { folders: kept.map(() => ({ error })), moved: new Map([...chosen].map(entry_id => [entry_id, { error }])) }
	}
	if (held_proposal() !== proposal) return []
	const path_of = (entry_id: string) => {
		try {
			return relative_to_root(proposal.root_id, entry_id)
		} catch {
			return undefined
		}
	}
	kept.forEach((decision, index) => {
		const folder = result.folders[index]
		if (folder && 'id' in folder) {
			const path = path_of(folder.id)
			if (path !== undefined) proposal.folders.push({ name: decision.to, created: folder.created, path })
		}
	})
	for (const row of proposal.rows) {
		if (!chosen.has(row.entry_id)) continue
		const moved = result.moved.get(row.entry_id)
		if (moved && 'id' in moved) {
			row.outcome = 'moved'
			const path = path_of(moved.id)
			if (path !== undefined) row.path = path
		} else {
			row.outcome = 'failed'
			row.error = (moved && 'error' in moved ? moved.error : '') || 'Not moved'
		}
	}
	return public_rows(proposal)
}

function require_moves(moves: { name: string; to: string }[], show_hidden: boolean) {
	if (moves.length === 0 || moves.length > MOVE_ROW_LIMIT) throw new McpError('bad_request')
	const names = new Set<string>()
	const targets = new Set<string>()
	for (const move of moves) {
		require_file_name(move.name)
		require_file_name(move.to)
		if (name_is_hidden(move.name, show_hidden) || name_is_hidden(move.to, show_hidden)) throw new McpError('not_allowed')
		if (same(move.name, move.to)) throw new McpError('bad_request')
		if (names.has(move.name)) throw new McpError('bad_request')
		names.add(move.name)
		targets.add(move.to.normalize('NFC').toLowerCase())
	}
	// A folder things go into stays where it is: A→B with B→A would put a folder inside itself
	for (const name of names) {
		if (targets.has(name.normalize('NFC').toLowerCase())) throw new McpError('bad_request')
	}
}

function public_rows(proposal: MoveProposal): MoveRowResult[] {
	return proposal.rows.map((row) => {
		const result: MoveRowResult = { name: row.name, to: row.to, outcome: row.outcome }
		if (row.outcome === 'moved' && row.path) result.path = row.path
		if (row.outcome === 'failed' && row.error) result.error = row.error
		return result
	})
}

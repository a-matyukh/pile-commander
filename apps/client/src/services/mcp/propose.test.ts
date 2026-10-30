import { beforeEach, describe, expect, test } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { DriveKind, FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { bulk_rename_request, close_bulk_rename, open_bulk_rename, open_proposed_rename, suggest_dialog_open } from '@/store/aiBulkRename'
import { get_folder } from './read'
import {
	NAME_CHAR_LIMIT,
	RENAME_ROW_LIMIT,
	close_proposal,
	confirm_proposal,
	forget_proposals,
	get_proposal,
	proposal_decisions,
	propose_rename,
	ready_proposal_rows,
	type ProposalPreview,
} from './propose'
import { McpError, type McpContext } from './types'

const HOME = '/home'
const root = { drive_id: 'local', root_id: HOME, path: '' }
const pair = [
	{ name: 'a.txt', to: 'alpha.txt' },
	{ name: 'b.txt', to: 'beta.txt' },
]

function local(folder_id: string, root_id = HOME): FolderRef {
	return { drive_id: 'local', root_id, folder_id }
}

type WorldOpts = {
	enabled?: boolean
	open?: FolderRef | null
	bookmarks?: readonly FolderRef[]
	realpath?: (path: string) => Promise<string>
}

function world(opts: WorldOpts = {}) {
	const fake = createFakeFileManager()
	const ctx: McpContext = {
		enabled: opts.enabled ?? true,
		show_hidden: false,
		open: opts.open === null ? null : { ref: opts.open ?? local(HOME), selection: [] },
		bookmarks: opts.bookmarks ?? [],
		drive_kind(id: string): DriveKind | null {
			if (id === 'local' || id === 'cloud' || id === 'browser' || id === 'demo') return id
			return null
		},
		loaded_folder: () => null,
		load_folder: id => fake.fm.folder_with_children_xattrs(id),
		read_file: id => fake.fm.read_text_file(id),
		entry_size: id => fake.fm.entry_size(id),
		realpath: opts.realpath ?? (async path => path),
	}
	return { fake, ctx }
}

function seed_pair(fake: ReturnType<typeof world>['fake']) {
	fake.seed_folder(HOME)
	fake.seed_file(`${HOME}/a.txt`, 'a')
	fake.seed_file(`${HOME}/b.txt`, 'b')
}

async function names_of(fake: ReturnType<typeof world>['fake'], folder = HOME): Promise<string[]> {
	const listed = await fake.fm.folder_with_children_xattrs(folder)
	return listed.children.map(child => child.name).sort()
}

/** The dialog's confirm: same row builder, same decisions, then the injected rename. */
async function accept(
	preview: ProposalPreview,
	rename: (id: string, name: string) => Promise<string | null>,
	uncheck: readonly string[] = [],
) {
	const rows = ready_proposal_rows(preview.rows)
	expect(rows.every(row => row.checked && row.status === 'ready')).toBe(true)
	for (const row of rows) {
		if (uncheck.includes(row.entry.name)) row.checked = false
	}
	const decisions = proposal_decisions(rows, preview.rows.map(row => row.name))
	await confirm_proposal(preview.proposal_id, decisions, rename)
	return decisions
}

async function code_of(run: Promise<unknown>): Promise<McpError> {
	try {
		await run
	} catch (error) {
		expect(error).toBeInstanceOf(McpError)
		return error as McpError
	}
	throw new Error('expected an MCP error')
}

describe('mcp propose_rename', () => {
	beforeEach(() => {
		forget_proposals()
		close_bulk_rename()
	})

	test('rename is not called before confirm, and rows start checked', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const calls: { id: string; name: string }[] = []
		const opened: ProposalPreview[] = []
		const rename = async (id: string, name: string) => {
			calls.push({ id, name })
			await fake.fm.rename(id, name)
			return null
		}

		const result = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { opened.push(preview) })

		expect(result).toEqual({ proposal_id: opened[0]?.proposal_id, status: 'pending' })
		expect(calls).toEqual([])
		expect(await names_of(fake)).toEqual(['a.txt', 'b.txt'])
		expect(opened[0]).toMatchObject({ client_name: 'Claude', reason: 'Clearer names' })
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({
			status: 'pending',
			client_name: 'Claude',
			reason: 'Clearer names',
			folder: root,
			rows: [
				{ name: 'a.txt', to: 'alpha.txt', outcome: 'pending' },
				{ name: 'b.txt', to: 'beta.txt', outcome: 'pending' },
			],
		})

		await accept(opened[0]!, rename, ['b.txt'])
		expect(get_proposal(ctx, result.proposal_id).status).toBe('pending')
		expect(calls).toEqual([{ id: `${HOME}/a.txt`, name: 'alpha.txt' }])
		expect(await names_of(fake)).toEqual(['alpha.txt', 'b.txt'])

		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({
			status: 'accepted',
			rows: [
				{ name: 'a.txt', to: 'alpha.txt', outcome: 'renamed', written_name: 'alpha.txt' },
				{ name: 'b.txt', to: 'beta.txt', outcome: 'skipped' },
			],
		})
	})

	test('closing the dialog writes nothing', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const opened: ProposalPreview[] = []
		const first = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { opened.push(preview) })

		close_proposal(first.proposal_id)
		expect(await names_of(fake)).toEqual(['a.txt', 'b.txt'])
		expect(get_proposal(ctx, first.proposal_id).status).toBe('dismissed')
		expect(get_proposal(ctx, first.proposal_id).rows.every(row => row.outcome === 'skipped')).toBe(true)

		const second = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { opened.push(preview) })
		expect(opened).toHaveLength(2)
		let missing: unknown
		try {
			get_proposal(ctx, first.proposal_id)
		} catch (error) {
			missing = error
		}
		expect(missing).toMatchObject({ code: 'proposal_not_found' })
		expect(second.status).toBe('pending')
	})

	test('a second proposal does not open another dialog', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const opened: ProposalPreview[] = []
		const open = (preview: ProposalPreview) => { opened.push(preview) }
		const first = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', open)

		const error = await code_of(propose_rename(ctx, {
			folder: root,
			reason: 'Another pass',
			renames: [{ name: 'a.txt', to: 'later.txt' }],
		}, 'Cursor', open))

		expect(error.code).toBe('busy')
		expect(error.proposal_id).toBe(first.proposal_id)
		expect(opened).toHaveLength(1)
		expect(opened[0]?.client_name).toBe('Claude')
		expect(await names_of(fake)).toEqual(['a.txt', 'b.txt'])
		expect(get_proposal(ctx, first.proposal_id).status).toBe('pending')
		const listed = await get_folder(ctx, root)
		expect(listed.entries.map(entry => entry.name).sort()).toEqual(['a.txt', 'b.txt'])
	})

	test('colliding names are written with the dialog suffix', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const calls: string[] = []
		const opened: ProposalPreview[] = []
		const result = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: [
				{ name: 'a.txt', to: 'same.txt' },
				{ name: 'b.txt', to: 'same.txt' },
			],
		}, 'Claude', (preview) => { opened.push(preview) })
		await accept(opened[0]!, async (id, name) => {
			calls.push(name)
			await fake.fm.rename(id, name)
			return null
		})
		close_proposal(result.proposal_id)
		expect(calls).toEqual(['same.txt', 'same (1).txt'])
		expect(await names_of(fake)).toEqual(['same (1).txt', 'same.txt'])
		const proposal = get_proposal(ctx, result.proposal_id)
		expect(proposal.rows.map(row => row.written_name)).toEqual(['same.txt', 'same (1).txt'])
	})

	test('a failed row stays pending until the dialog closes', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const opened: ProposalPreview[] = []
		const result = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { opened.push(preview) })
		await accept(opened[0]!, async (id, name) => {
			if (name === 'beta.txt') return 'disk full'
			await fake.fm.rename(id, name)
			return null
		})
		expect(get_proposal(ctx, result.proposal_id).status).toBe('pending')
		expect(await names_of(fake)).toEqual(['alpha.txt', 'b.txt'])
		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({
			status: 'accepted',
			rows: [
				{ name: 'a.txt', outcome: 'renamed', written_name: 'alpha.txt' },
				{ name: 'b.txt', outcome: 'failed', error: 'disk full' },
			],
		})
	})

	test('a rejected proposal does not open the dialog', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		fake.seed_folder(`${HOME}/sub`)
		fake.seed_file(`${HOME}/sub/deep.txt`, 'no')
		fake.seed_file(`${HOME}/link`, 'out')
		const opened: ProposalPreview[] = []
		const open = (preview: ProposalPreview) => { opened.push(preview) }

		async function propose(
			renames: { name: string; to: string }[],
			reason = 'Clearer names',
			folder = root,
			context = ctx,
		) {
			return code_of(propose_rename(context, { folder, reason, renames }, 'Claude', open))
		}

		expect((await propose([], 'Clearer names')).code).toBe('bad_request')
		expect((await propose(pair, '   ')).code).toBe('bad_request')
		expect((await propose(pair, 'x'.repeat(501))).code).toBe('bad_request')
		expect((await propose([{ name: 'a/b.txt', to: 'c.txt' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'a.txt', to: '..' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'a.txt', to: 'a'.repeat(NAME_CHAR_LIMIT + 1) }])).code).toBe('bad_request')
		expect((await propose([
			{ name: 'a.txt', to: 'one.txt' },
			{ name: 'a.txt', to: 'two.txt' },
		])).code).toBe('bad_request')
		expect((await propose(Array.from({ length: RENAME_ROW_LIMIT + 1 }, (_, index) => ({
			name: `f${index}.txt`,
			to: `g${index}.txt`,
		})))).code).toBe('bad_request')
		expect((await propose([{ name: 'missing.txt', to: 'nope.txt' }])).code).toBe('not_found')
		expect((await propose([{ name: '.secret', to: 'nope.txt' }])).code).toBe('not_allowed')
		expect((await propose(
			[{ name: 'deep.txt', to: 'nope.txt' }],
			'Clearer names',
			{ ...root, path: 'sub' },
		)).code).toBe('not_allowed')

		const linked = world({
			realpath: async path => path === `${HOME}/link` ? '/etc/passwd' : path,
		})
		linked.fake.seed_folder(HOME)
		linked.fake.seed_file(`${HOME}/link`, 'out')
		expect((await propose(
			[{ name: 'link', to: 'outside.txt' }],
			'Clearer names',
			root,
			linked.ctx,
		)).code).toBe('path_outside_root')

		const off = world({ enabled: false })
		expect((await propose(pair, 'Clearer names', root, off.ctx)).code).toBe('mcp_disabled')
		expect(opened).toEqual([])
	})

	test('an open suggest dialog makes propose_rename busy and leaves the dialog', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const workspace = {} as WorkspaceStore
		open_bulk_rename(workspace, `${HOME}/kept`, [{ id: `${HOME}/kept/a.txt`, name: 'a.txt', type: 'file' }])
		const run = bulk_rename_request.run
		const opened: ProposalPreview[] = []
		const error = await code_of(propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { opened.push(preview) }, suggest_dialog_open))

		expect(error.code).toBe('busy')
		expect(error.proposal_id).toBeUndefined()
		expect(opened).toEqual([])
		expect(bulk_rename_request.open).toBe(true)
		expect(bulk_rename_request.source).toBe('suggest')
		expect(bulk_rename_request.folder_id).toBe(`${HOME}/kept`)
		expect(bulk_rename_request.run).toBe(run)
		expect(await names_of(fake)).toEqual(['a.txt', 'b.txt'])
	})

	test('suggest names over a proposal dismisses it, and the next proposal can open', async () => {
		const { fake, ctx } = world()
		seed_pair(fake)
		const workspace = {} as WorkspaceStore
		const first = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { open_proposed_rename(workspace, preview) }, suggest_dialog_open)
		expect(get_proposal(ctx, first.proposal_id).status).toBe('pending')

		open_bulk_rename(workspace, `${HOME}/other`, [{ id: `${HOME}/b.txt`, name: 'b.txt', type: 'file' }])
		expect(get_proposal(ctx, first.proposal_id).status).toBe('dismissed')
		expect(get_proposal(ctx, first.proposal_id).rows.every(row => row.outcome === 'skipped')).toBe(true)
		expect(await names_of(fake)).toEqual(['a.txt', 'b.txt'])

		close_bulk_rename()
		const opened: ProposalPreview[] = []
		const second = await propose_rename(ctx, {
			folder: root,
			reason: 'Clearer names',
			renames: pair,
		}, 'Claude', (preview) => { opened.push(preview) }, suggest_dialog_open)
		expect(second.status).toBe('pending')
		expect(opened).toHaveLength(1)
	})

	test('a bookmark folder can propose a nested file', async () => {
		const { fake, ctx } = world({ bookmarks: [local(`${HOME}/projects`)] })
		fake.seed_folder(HOME)
		fake.seed_folder(`${HOME}/projects`)
		fake.seed_folder(`${HOME}/projects/app`)
		fake.seed_file(`${HOME}/projects/app/note.md`, 'x')
		const opened: ProposalPreview[] = []
		const result = await propose_rename(ctx, {
			folder: { drive_id: 'local', root_id: HOME, path: 'projects/app' },
			reason: 'Clearer names',
			renames: [{ name: 'note.md', to: 'notes.md' }],
		}, 'Claude', (preview) => { opened.push(preview) })
		expect(result.status).toBe('pending')
		expect(opened).toHaveLength(1)
		expect(opened[0]?.rows).toEqual([
			{ id: `${HOME}/projects/app/note.md`, name: 'note.md', type: 'file', to: 'notes.md' },
		])
	})
})

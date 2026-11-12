import { beforeEach, describe, expect, test } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { DriveKind, FolderRef } from '@/domain/Drive'
import { close_proposal, forget_proposals, get_proposal } from './proposal'
import { propose_create } from './propose_create'
import {
	MOVE_ROW_LIMIT,
	NEW_FOLDER_LIMIT,
	confirm_move,
	propose_move,
	type MoveDecision,
	type MovePreview,
	type MoveWriteResult,
} from './propose_move'
import { McpError, type McpContext } from './types'

const HOME = '/home'
const root = { drive_id: 'local', root_id: HOME, path: '' }

function local(folder_id: string, root_id = HOME): FolderRef {
	return { drive_id: 'local', root_id, folder_id }
}

function world(opts: { bookmarks?: readonly FolderRef[]; enabled?: boolean } = {}) {
	const fake = createFakeFileManager()
	const ctx: McpContext = {
		enabled: opts.enabled ?? true,
		show_hidden: false,
		open: { ref: local(HOME), selection: [] },
		bookmarks: opts.bookmarks ?? [],
		drive_kind(id: string): DriveKind | null {
			if (id === 'local' || id === 'cloud' || id === 'browser' || id === 'demo') return id
			return null
		},
		loaded_folder: () => null,
		load_folder: id => fake.fm.folder_with_children_xattrs(id),
		read_file: id => fake.fm.read_text_file(id),
		entry_size: id => fake.fm.entry_size(id),
		realpath: async path => path,
	}
	fake.seed_folder(HOME)
	fake.seed_file(`${HOME}/beach.jpg`, 'b')
	fake.seed_file(`${HOME}/sunset.jpg`, 's')
	fake.seed_file(`${HOME}/plan.md`, 'p')
	fake.seed_folder(`${HOME}/Photos`)
	return { fake, ctx }
}

async function tree(fake: ReturnType<typeof world>['fake'], folder = HOME): Promise<string[]> {
	const listed = await fake.fm.folder_with_children_xattrs(folder)
	const names: string[] = []
	for (const child of listed.children) {
		names.push(child.name)
		if (child.type === 'folder') {
			for (const inner of await tree(fake, child.id)) names.push(`${child.name}/${inner}`)
		}
	}
	return names.sort()
}

/** The preview's write: new folders under the names kept, then the moves, on the fake disk. */
function writer(fake: ReturnType<typeof world>['fake'], preview: MovePreview) {
	return async (decisions: readonly MoveDecision[]): Promise<MoveWriteResult> => {
		const moved: MoveWriteResult['moved'] = new Map()
		const folders: MoveWriteResult['folders'] = []
		for (const decision of decisions) {
			const group = preview.groups.find(entry => entry.to === decision.to)!
			let target = group.existing_id
			if (!target) target = (await fake.fm.create_folder(preview.folder_id, decision.name)).id
			folders.push({ id: target, name: decision.name, created: !group.existing_id })
			for (const entry_id of decision.entry_ids) moved.set(entry_id, { id: (await fake.fm.move(entry_id, target)).id })
		}
		return { folders, moved }
	}
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

describe('mcp propose_move', () => {
	beforeEach(() => {
		forget_proposals()
	})

	test('nothing moves before confirm; kept items move and report their paths', async () => {
		const { fake, ctx } = world()
		const opened: MovePreview[] = []
		const result = await propose_move(ctx, {
			folder: root,
			reason: 'Sort by kind',
			moves: [
				{ name: 'beach.jpg', to: 'photos' },
				{ name: 'sunset.jpg', to: 'Photos' },
				{ name: 'plan.md', to: 'Notes' },
			],
		}, 'Claude', (preview) => { opened.push(preview) })

		expect(result.status).toBe('pending')
		expect(await tree(fake)).toEqual(['Photos', 'beach.jpg', 'plan.md', 'sunset.jpg'])
		// "photos" is the existing "Photos": one group, matched without case
		expect(opened[0]?.groups.map(group => [group.to, group.existing_id, group.entries.map(entry => entry.name)])).toEqual([
			['Photos', `${HOME}/Photos`, ['beach.jpg', 'sunset.jpg']],
			['Notes', null, ['plan.md']],
		])

		await confirm_move(result.proposal_id, [
			{ to: 'Photos', name: 'Photos', entry_ids: [`${HOME}/beach.jpg`] },
			{ to: 'Notes', name: 'Plans', entry_ids: [`${HOME}/plan.md`] },
		], writer(fake, opened[0]!))
		expect(await tree(fake)).toEqual(['Photos', 'Photos/beach.jpg', 'Plans', 'Plans/plan.md', 'sunset.jpg'])

		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({
			kind: 'move',
			status: 'accepted',
			rows: [
				{ name: 'beach.jpg', to: 'Photos', outcome: 'moved', path: 'Photos/beach.jpg' },
				{ name: 'sunset.jpg', to: 'Photos', outcome: 'skipped' },
				{ name: 'plan.md', to: 'Notes', outcome: 'moved', path: 'Plans/plan.md' },
			],
			folders: [
				{ name: 'Photos', created: false, path: 'Photos' },
				{ name: 'Notes', created: true, path: 'Plans' },
			],
		})
	})

	test('closing the preview moves nothing and is dismissed', async () => {
		const { fake, ctx } = world()
		const result = await propose_move(ctx, { folder: root, reason: 'Sort', moves: [{ name: 'plan.md', to: 'Notes' }] }, 'Claude', () => {})
		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({ status: 'dismissed', rows: [{ outcome: 'skipped' }] })
		expect(await tree(fake)).toEqual(['Photos', 'beach.jpg', 'plan.md', 'sunset.jpg'])
	})

	test('a failed move is reported for its row', async () => {
		const { ctx } = world()
		const result = await propose_move(ctx, { folder: root, reason: 'Sort', moves: [{ name: 'plan.md', to: 'Notes' }] }, 'Claude', () => {})
		await confirm_move(result.proposal_id, [{ to: 'Notes', name: 'Notes', entry_ids: [`${HOME}/plan.md`] }], async () => ({
			folders: [{ error: 'disk full' }],
			moved: new Map([[`${HOME}/plan.md`, { error: 'disk full' }]]),
		}))
		expect(get_proposal(ctx, result.proposal_id).rows).toEqual([{ name: 'plan.md', to: 'Notes', outcome: 'failed', error: 'disk full' }])
	})

	test('bad moves are refused before any preview opens', async () => {
		const { ctx } = world()
		const opened: MovePreview[] = []
		const propose = (moves: { name: string; to: string }[]) => code_of(propose_move(ctx, { folder: root, reason: 'Sort', moves }, 'Claude', (preview) => { opened.push(preview) }))

		expect((await propose([])).code).toBe('bad_request')
		expect((await propose([{ name: 'plan.md', to: 'plan.md' }])).code).toBe('bad_request')
		// a folder things go into stays: A→B with B→A would put a folder in itself
		expect((await propose([{ name: 'Photos', to: 'Archive' }, { name: 'plan.md', to: 'Photos' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'plan.md', to: 'A' }, { name: 'plan.md', to: 'B' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'beach.jpg', to: 'plan.md' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'beach.jpg', to: 'a/b' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'gone.jpg', to: 'Photos' }])).code).toBe('not_found')
		expect((await propose([{ name: 'beach.jpg', to: '.hidden' }])).code).toBe('not_allowed')
		expect((await propose(Array.from({ length: MOVE_ROW_LIMIT + 1 }, (_, index) => ({ name: `f${index}`, to: 'X' })))).code).toBe('bad_request')
		expect(opened).toEqual([])
	})

	test('too many new folders are refused', async () => {
		const { fake, ctx } = world()
		const moves = Array.from({ length: NEW_FOLDER_LIMIT + 1 }, (_, index) => {
			fake.seed_file(`${HOME}/f${index}.txt`, 'x')
			return { name: `f${index}.txt`, to: `Folder ${index}` }
		})
		expect((await code_of(propose_move(ctx, { folder: root, reason: 'Sort', moves }, 'Claude', () => {}))).code).toBe('bad_request')
	})

	test('one slot for every kind: a pending create makes move busy', async () => {
		const { ctx } = world()
		const create = await propose_create(ctx, { folder: root, reason: 'Ideas', files: [{ name: 'Idea', text: 'x' }] }, 'Claude', () => {})
		const busy = await code_of(propose_move(ctx, { folder: root, reason: 'Sort', moves: [{ name: 'plan.md', to: 'Notes' }] }, 'Claude', () => {}))
		expect(busy.code).toBe('busy')
		expect(busy.proposal_id).toBe(create.proposal_id)
	})

	test('only where the agent could read: a new folder inside a listed subfolder is not', async () => {
		const outside = world()
		outside.fake.seed_folder(`${HOME}/Photos/raw`)
		outside.fake.seed_file(`${HOME}/Photos/a.jpg`, 'a')
		const photos = { drive_id: 'local', root_id: HOME, path: 'Photos' }
		expect((await code_of(propose_move(outside.ctx, { folder: photos, reason: 'Sort', moves: [{ name: 'a.jpg', to: 'raw' }] }, 'Claude', () => {}))).code).toBe('not_allowed')

		forget_proposals()
		const inside = world({ bookmarks: [local(`${HOME}/Photos`)] })
		inside.fake.seed_folder(`${HOME}/Photos/raw`)
		inside.fake.seed_file(`${HOME}/Photos/a.jpg`, 'a')
		const result = await propose_move(inside.ctx, { folder: photos, reason: 'Sort', moves: [{ name: 'a.jpg', to: 'New' }] }, 'Claude', () => {})
		expect(result.status).toBe('pending')
	})
})

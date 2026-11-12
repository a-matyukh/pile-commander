import { beforeEach, describe, expect, test } from 'vitest'
import { createFakeFileManager } from '@pile-commander/file-manager'
import type { DriveKind, FolderRef } from '@/domain/Drive'
import { planned_note_names } from '@/services/ai/newNotes'
import { close_proposal, forget_proposals, get_proposal } from './proposal'
import { propose_rename } from './propose'
import { CREATE_FILE_LIMIT, confirm_create, propose_create, type CreateOutcome, type CreatePreview } from './propose_create'
import { McpError, TEXT_BYTE_LIMIT, type McpContext } from './types'

const HOME = '/home'
const root = { drive_id: 'local', root_id: HOME, path: '' }
const ideas = [
	{ name: 'Fog at dawn', text: '# Fog at dawn\n\nShoot the pier before sunrise.' },
	{ name: 'Lighthouse close-up.md', text: 'Red and white, up close.' },
]

function local(folder_id: string, root_id = HOME): FolderRef {
	return { drive_id: 'local', root_id, folder_id }
}

function world(opts: { open?: FolderRef | null; bookmarks?: readonly FolderRef[]; enabled?: boolean } = {}) {
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
		realpath: async path => path,
	}
	fake.seed_folder(HOME)
	return { fake, ctx }
}

async function names_of(fake: ReturnType<typeof world>['fake'], folder = HOME): Promise<string[]> {
	const listed = await fake.fm.folder_with_children_xattrs(folder)
	return listed.children.map(child => child.name).sort()
}

/** The preview's write: the names it showed, then a plain file per note. */
function writer(fake: ReturnType<typeof world>['fake'], preview: CreatePreview, siblings: string[] = []) {
	const names = planned_note_names(preview.files.map(file => file.name), siblings)
	return async (rows: readonly { index: number; name: string; text: string }[]): Promise<CreateOutcome[]> => {
		const outcomes: CreateOutcome[] = []
		for (const row of rows) {
			const name = names[row.index]!
			const node = await fake.fm.create_text_file(preview.folder_id, name, { content: row.text })
			outcomes.push({ id: node.id, written_name: name })
		}
		return outcomes
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

describe('mcp propose_create', () => {
	beforeEach(() => {
		forget_proposals()
	})

	test('nothing is written before confirm; checked notes are created with paths', async () => {
		const { fake, ctx } = world()
		const opened: CreatePreview[] = []
		const result = await propose_create(ctx, { folder: root, reason: 'Ideas for the harbor', files: ideas }, 'Claude', (preview) => {
			opened.push(preview)
		})

		expect(result).toEqual({ proposal_id: opened[0]?.proposal_id, status: 'pending' })
		expect(await names_of(fake)).toEqual([])
		expect(opened[0]?.files.map(file => file.name)).toEqual(['Fog at dawn.md', 'Lighthouse close-up.md'])
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({
			kind: 'create',
			status: 'pending',
			client_name: 'Claude',
			reason: 'Ideas for the harbor',
			rows: [
				{ name: 'Fog at dawn.md', outcome: 'pending' },
				{ name: 'Lighthouse close-up.md', outcome: 'pending' },
			],
		})

		await confirm_create(result.proposal_id, [true, false], writer(fake, opened[0]!))
		expect(await names_of(fake)).toEqual(['Fog at dawn.md'])
		expect(get_proposal(ctx, result.proposal_id).status).toBe('pending')

		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id)).toMatchObject({
			kind: 'create',
			status: 'accepted',
			rows: [
				{ name: 'Fog at dawn.md', outcome: 'created', written_name: 'Fog at dawn.md', path: 'Fog at dawn.md' },
				{ name: 'Lighthouse close-up.md', outcome: 'skipped' },
			],
		})
	})

	test('a taken name is written with a suffix and reported', async () => {
		const { fake, ctx } = world()
		fake.seed_file(`${HOME}/Fog at dawn.md`, 'old')
		const opened: CreatePreview[] = []
		const result = await propose_create(ctx, { folder: root, reason: 'Ideas', files: [ideas[0]!] }, 'Claude', (preview) => {
			opened.push(preview)
		})
		await confirm_create(result.proposal_id, [true], writer(fake, opened[0]!, ['Fog at dawn.md']))
		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id).rows[0]).toMatchObject({
			outcome: 'created',
			written_name: 'Fog at dawn (1).md',
			path: 'Fog at dawn (1).md',
		})
		expect(await names_of(fake)).toEqual(['Fog at dawn (1).md', 'Fog at dawn.md'])
	})

	test('closing the preview writes nothing and is dismissed', async () => {
		const { fake, ctx } = world()
		const result = await propose_create(ctx, { folder: root, reason: 'Ideas', files: ideas }, 'Claude', () => {})
		close_proposal(result.proposal_id)
		expect(get_proposal(ctx, result.proposal_id).status).toBe('dismissed')
		expect(get_proposal(ctx, result.proposal_id).rows.every(row => row.outcome === 'skipped')).toBe(true)
		expect(await names_of(fake)).toEqual([])
	})

	test('a failed write is reported per note', async () => {
		const { ctx } = world()
		const result = await propose_create(ctx, { folder: root, reason: 'Ideas', files: ideas }, 'Claude', () => {})
		await confirm_create(result.proposal_id, [true, true], async rows => rows.map(row => (row.index === 0 ? { error: 'disk full' } : { written_name: row.name })))
		expect(get_proposal(ctx, result.proposal_id).rows).toEqual([
			{ name: 'Fog at dawn.md', outcome: 'failed', error: 'disk full' },
			{ name: 'Lighthouse close-up.md', outcome: 'created', written_name: 'Lighthouse close-up.md' },
		])
	})

	test('one slot for every kind: a pending rename makes create busy, and the other way round', async () => {
		const { fake, ctx } = world()
		fake.seed_file(`${HOME}/a.txt`, 'a')
		const rename = await propose_rename(ctx, { folder: root, reason: 'Names', renames: [{ name: 'a.txt', to: 'alpha.txt' }] }, 'Claude', () => {})
		const busy = await code_of(propose_create(ctx, { folder: root, reason: 'Ideas', files: ideas }, 'Claude', () => {}))
		expect(busy.code).toBe('busy')
		expect(busy.proposal_id).toBe(rename.proposal_id)

		close_proposal(rename.proposal_id)
		const create = await propose_create(ctx, { folder: root, reason: 'Ideas', files: ideas }, 'Claude', () => {})
		const busy_rename = await code_of(propose_rename(ctx, { folder: root, reason: 'Names', renames: [{ name: 'a.txt', to: 'alpha.txt' }] }, 'Claude', () => {}))
		expect(busy_rename.code).toBe('busy')
		expect(busy_rename.proposal_id).toBe(create.proposal_id)
	})

	test('the person\'s own session makes an agent busy', async () => {
		const { ctx } = world()
		const error = await code_of(propose_create(ctx, { folder: root, reason: 'Ideas', files: ideas }, 'Claude', () => {}, () => true))
		expect(error.code).toBe('busy')
		expect(error.proposal_id).toBeUndefined()
	})

	test('bad files are refused before any preview opens', async () => {
		const { ctx } = world()
		const opened: CreatePreview[] = []
		const open = (preview: CreatePreview) => { opened.push(preview) }
		const propose = (files: { name: string; text: string }[], reason = 'Ideas') => code_of(propose_create(ctx, { folder: root, reason, files }, 'Claude', open))

		expect((await propose([])).code).toBe('bad_request')
		expect((await propose(Array.from({ length: CREATE_FILE_LIMIT + 1 }, (_, index) => ({ name: `Idea ${index}`, text: '' })))).code).toBe('bad_request')
		expect((await propose([{ name: 'notes.txt', text: 'x' }])).code).toBe('bad_request')
		expect((await propose([{ name: '   ', text: 'x' }])).code).toBe('bad_request')
		expect((await propose([{ name: 'a/b', text: 'x' }])).code).toBe('bad_request')
		expect((await propose([{ name: '.secret', text: 'x' }])).code).toBe('not_allowed')
		expect((await propose([{ name: 'Big', text: 'x'.repeat(TEXT_BYTE_LIMIT + 1) }])).code).toBe('too_large')
		expect((await propose(ideas, '  ')).code).toBe('bad_request')
		expect(opened).toEqual([])
	})

	test('a version-like name still gets .md', async () => {
		const { ctx } = world()
		const opened: CreatePreview[] = []
		await propose_create(ctx, { folder: root, reason: 'Ideas', files: [{ name: 'Plan v1.2', text: 'x' }] }, 'Claude', (preview) => {
			opened.push(preview)
		})
		expect(opened[0]?.files[0]?.name).toBe('Plan v1.2.md')
	})

	test('only where the agent could read: the open folder, or inside a bookmark', async () => {
		const outside = world()
		outside.fake.seed_folder(`${HOME}/sub`)
		const sub = { drive_id: 'local', root_id: HOME, path: 'sub' }
		// `sub` is a direct child of the open `~`: listed, but its children are not readable
		expect((await code_of(propose_create(outside.ctx, { folder: sub, reason: 'Ideas', files: ideas }, 'Claude', () => {}))).code).toBe('not_allowed')

		forget_proposals()
		const inside = world({ bookmarks: [local(`${HOME}/sub`)] })
		inside.fake.seed_folder(`${HOME}/sub`)
		const result = await propose_create(inside.ctx, { folder: sub, reason: 'Ideas', files: ideas }, 'Claude', () => {})
		expect(result.status).toBe('pending')
	})

	test('a cloud folder and switched-off access are refused', async () => {
		const { ctx } = world()
		expect((await code_of(propose_create(ctx, {
			folder: { drive_id: 'cloud', root_id: 'w1', path: '' },
			reason: 'Ideas',
			files: ideas,
		}, 'Claude', () => {}))).code).toBe('drive_not_in_v1')

		const off = world({ enabled: false })
		expect((await code_of(propose_create(off.ctx, { folder: root, reason: 'Ideas', files: ideas }, 'Claude', () => {}))).code).toBe('mcp_disabled')
	})
})

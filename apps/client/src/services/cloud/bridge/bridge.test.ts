import { describe, expect, test, vi } from 'vitest'
import {
	PlanLimitError,
	createFakeFileManager,
	type FakeFileManager,
} from '@pile-commander/file-manager'
import { copy_tree } from './copyTree'
import { filter_manifest } from './manifest'
import { file_kind, is_cloud_name, preflight_tree, type BridgeLimits } from './preflight'
import { bridge_job_key, run_bridge, type BridgeDeps, type BridgeJob, type BridgeRun } from './runBridge'

const MB = 1024 * 1024
const LIMITS: BridgeLimits = { quota_bytes: 100 * MB, used_bytes: 0, max_file_bytes: 25 * MB }

function bytes(size: number): Blob {
	return new Blob([new Uint8Array(size)])
}

/** A local-style workspace: nested folders, a note, media, ink, an edge, layout, OS litter. */
async function make_source(): Promise<FakeFileManager> {
	const src = createFakeFileManager()
	src.seed_folder('/ws')
	src.seed_folder('/ws/board')
	src.seed_folder('/ws/board/refs')
	src.seed_file('/ws/board/note.md', '# hello')
	await src.fm.upload_file('/ws/board', 'photo.png', bytes(2048), 'image/png')
	await src.fm.upload_file('/ws/board/refs', 'clip.mp4', bytes(4096), 'video/mp4')
	src.seed_file('/ws/.DS_Store', 'junk')
	src.set_xattr('/ws', 'view', 'board')
	src.set_xattr('/ws/board', 'is_preview', 'true')
	src.set_xattr('/ws/board/note.md', 'position', '{"x":10,"y":20}')
	src.set_xattr('/ws/board/photo.png', 'position', '{"x":30,"y":40}')
	src.seed_strokes('/ws/board', [{
		id: 'local-stroke',
		z: 1,
		position: { x: 0, y: 0 },
		points: [{ x: 0, y: 0 }],
		color: '#000',
		stroke_width: 2,
		width: 4,
		height: 4,
	}])
	src.seed_connections('/ws/board', [{
		id: '/ws/board/note.md:default-/ws/board/photo.png:default',
		from: '/ws/board/note.md',
		to: '/ws/board/photo.png',
		is_animated: false,
	}])
	src.calls.length = 0
	return src
}

function make_dest(): FakeFileManager {
	const dst = createFakeFileManager()
	dst.seed_folder('/')
	return dst
}

function make_deps(dst: FakeFileManager) {
	const jobs = new Map<string, BridgeJob>()
	let created = 0
	const deps: BridgeDeps = {
		create_workspace: vi.fn(async () => `ws-${++created}`),
		workspace_fm: () => dst.fm,
		workspace_exists: async () => true,
		jobs: {
			get: key => jobs.get(key) ?? null,
			set: (key, job) => {
				jobs.set(key, job)
			},
			remove: (key) => {
				jobs.delete(key)
			},
		},
	}
	return { deps, jobs }
}

async function make_run(src: FakeFileManager, patch: Partial<BridgeRun> = {}): Promise<BridgeRun> {
	return {
		job_key: bridge_job_key('user-1', { type: 'local', id: '/ws' }),
		name: 'Workspace',
		source_fm: src.fm,
		source_root: '/ws',
		preflight: await preflight_tree(src.fm, '/ws', LIMITS),
		exclude: new Set(),
		...patch,
	}
}

describe('bridge preflight', () => {
	test('measures the tree, skipping sidecars and OS litter', async () => {
		const src = await make_source()

		const preflight = await preflight_tree(src.fm, '/ws', LIMITS)

		expect(preflight.folders).toEqual(['board', 'board/refs'])
		expect(preflight.files.map(file => file.relative).sort())
			.toEqual(['board/note.md', 'board/photo.png', 'board/refs/clip.mp4'])
		expect(preflight.total_bytes).toBe(7 + 2048 + 4096)
		expect(preflight.largest?.relative).toBe('board/refs/clip.mp4')
		expect(preflight.bytes_by_kind).toEqual({ image: 2048, video: 4096, audio: 0, text: 7, other: 0 })
		expect(preflight.over_quota).toBe(false)
		expect(preflight.blocked).toEqual([])
		expect(preflight.suggested_exclude).toEqual([])
	})

	test('flags what the plan or the cloud refuses and suggests leaving it out', async () => {
		const src = createFakeFileManager()
		src.seed_folder('/ws')
		await src.fm.upload_file('/ws', 'movie.mov', bytes(6_000), 'video/quicktime')
		await src.fm.upload_file('/ws', 'big.png', bytes(4_000), 'image/png')
		await src.fm.upload_file('/ws', 'small.png', bytes(1_000), 'image/png')
		src.seed_file('/ws/badname.txt', 'x')

		const preflight = await preflight_tree(src.fm, '/ws', {
			quota_bytes: 10_000,
			used_bytes: 6_000,
			max_file_bytes: 5_000,
		})
		const by_name = new Map(preflight.files.map(file => [file.name, file]))

		expect(by_name.get('movie.mov')?.over_file_limit).toBe(true)
		expect(by_name.get('badname.txt')?.bad_name).toBe(true)
		expect(preflight.free_bytes).toBe(4_000)
		expect(preflight.over_quota).toBe(true)
		// blocked files first, then the largest of the rest until 1 000 bytes fit
		expect([...preflight.suggested_exclude].sort()).toEqual(['badname.txt', 'big.png', 'movie.mov'])
	})

	test('a folder the cloud cannot name takes its subtree out', async () => {
		const src = createFakeFileManager()
		src.seed_folder('/ws')
		src.seed_folder('/ws/badfolder')
		src.seed_file('/ws/badfolder/inner.md', 'x')

		const preflight = await preflight_tree(src.fm, '/ws', LIMITS)

		expect(preflight.folders).toEqual([])
		expect(preflight.files[0]).toMatchObject({ relative: 'badfolder/inner.md', bad_name: true })
	})

	test('kinds and cloud names', () => {
		expect(file_kind('a.JPG')).toBe('image')
		expect(file_kind('notes.md')).toBe('text')
		expect(file_kind('scene.glb')).toBe('other')
		expect(is_cloud_name('ok name.txt')).toBe(true)
		expect(is_cloud_name('tab\there')).toBe(false)
		expect(is_cloud_name('x'.repeat(256))).toBe(false)
	})
})

describe('copy_tree', () => {
	test('text over the cloud text limit goes up as a binary file', async () => {
		const src = createFakeFileManager()
		src.seed_folder('/ws')
		src.seed_file('/ws/huge.md', 'a'.repeat(8 * MB + 1))
		const preflight = await preflight_tree(src.fm, '/ws', LIMITS)
		expect(preflight.files[0]).toMatchObject({ kind: 'text', text_as_blob: true })
		const dst = make_dest()

		const result = await copy_tree(src.fm, dst.fm, '/', preflight, { exclude: new Set() })

		expect(result).toEqual({ kind: 'done', uploaded: 1, skipped: 0 })
		expect(dst.calls.find(call => call.method === 'upload_file')?.args)
			.toEqual(['/', 'huge.md', 8 * MB + 1, 'application/octet-stream'])
	})

	test('reports byte progress up to the whole copy', async () => {
		const src = await make_source()
		const preflight = await preflight_tree(src.fm, '/ws', LIMITS)
		const dst = make_dest()
		const seen: number[] = []

		await copy_tree(src.fm, dst.fm, '/', preflight, {
			exclude: new Set(),
			on_progress: progress => seen.push(progress.loaded_bytes),
		})

		expect(seen[0]).toBe(0)
		expect(seen.at(-1)).toBe(preflight.total_bytes)
	})

	test('creates sibling folders at once, a level after its parents, and reports it', async () => {
		const src = createFakeFileManager()
		src.seed_folder('/ws')
		for (const name of ['a', 'b', 'c', 'd']) {
			src.seed_folder(`/ws/${name}`)
			src.seed_folder(`/ws/${name}/inner`)
		}
		const preflight = await preflight_tree(src.fm, '/ws', LIMITS)
		const dst = make_dest()
		const create_folder = dst.fm.create_folder.bind(dst.fm)
		let in_flight = 0
		let most_at_once = 0
		const created: string[] = []
		dst.fm.create_folder = async (parent, name, options) => {
			in_flight += 1
			most_at_once = Math.max(most_at_once, in_flight)
			await new Promise(resolve => setTimeout(resolve, 5))
			in_flight -= 1
			created.push(parent === '/' ? name : `${parent.slice(1)}/${name}`)
			return create_folder(parent, name, options)
		}
		const phases: string[] = []

		await copy_tree(src.fm, dst.fm, '/', preflight, {
			exclude: new Set(),
			on_progress: progress => phases.push(`${progress.phase} ${progress.folders_done}/${progress.total_folders}`),
		})

		expect(most_at_once).toBe(4)
		expect(created.slice(0, 4).sort()).toEqual(['a', 'b', 'c', 'd'])
		expect(created.slice(4).sort()).toEqual(['a/inner', 'b/inner', 'c/inner', 'd/inner'])
		expect(phases[0]).toBe('folders 0/8')
		expect(phases).toContain('folders 8/8')
		expect(phases.at(-1)).toBe('files 8/8')
		expect(dst.has('/d/inner')).toBe(true)
	})
})

describe('filter_manifest', () => {
	test('keeps the layout of copied entries and drops edges with a left-out end', () => {
		const manifest = {
			version: 1,
			attrs: {
				'': { view: 'board' },
				'board': {
					is_preview: 'true',
					canvas: JSON.stringify({
						connections: [
							{ id: 'to-left-out', from: 'board/a.md', to: 'board/b.png', is_animated: false },
							{ id: 'kept', from: 'board/a.md', to: 'board/c.md', is_animated: false },
						],
					}),
				},
				'board/b.png': { position: '{}' },
				'.DS_Store': { junk: '1' },
			},
		}

		const filtered = filter_manifest(manifest, new Set(['', 'board', 'board/a.md', 'board/c.md']))

		expect(Object.keys(filtered.attrs).sort()).toEqual(['', 'board'])
		expect(filtered.attrs.board!.is_preview).toBe('true')
		const connections = JSON.parse(filtered.attrs.board!.canvas!).connections as { id: string }[]
		expect(connections.map(connection => connection.id)).toEqual(['kept'])
	})
})

describe('run_bridge', () => {
	test('copies files, layout, ink under fresh ids and edges rebased onto the cloud root', async () => {
		const src = await make_source()
		const dst = make_dest()
		const { deps, jobs } = make_deps(dst)

		const result = await run_bridge(deps, await make_run(src))

		expect(result).toEqual({ kind: 'done', workspace_id: 'ws-1', missing: [] })
		expect(await dst.fm.read_text_file('/board/note.md')).toBe('# hello')
		expect(dst.get_blob('/board/refs/clip.mp4')?.size).toBe(4096)
		expect(dst.has('/.DS_Store')).toBe(false)
		expect(dst.get_xattr('/', 'view')).toBe('board')
		expect(dst.get_xattr('/board', 'is_preview')).toBe('true')
		expect(dst.get_xattr('/board/photo.png', 'position')).toBe('{"x":30,"y":40}')
		const strokes = await dst.fm.strokes.list_strokes('/board')
		expect(strokes).toHaveLength(1)
		expect(strokes[0]!.id).not.toBe('local-stroke')
		expect(await dst.fm.connections.list_connections('/board')).toEqual([{
			id: '/board/note.md:default-/board/photo.png:default',
			from: '/board/note.md',
			to: '/board/photo.png',
			is_animated: false,
		}])
		expect(jobs.get('user-1:local:/ws')?.phase).toBe('done')
		// the source is only read
		const writes = ['upload_file', 'create_folder', 'set_xattr', 'set_xattrs', 'remove', 'upsert_strokes']
		expect(src.calls.filter(call => writes.includes(call.method))).toEqual([])
	})

	test('leaves out excluded files together with their layout and edges', async () => {
		const src = await make_source()
		const dst = make_dest()
		const { deps } = make_deps(dst)

		const result = await run_bridge(deps, await make_run(src, { exclude: new Set(['board/photo.png']) }))

		expect(result).toEqual({ kind: 'done', workspace_id: 'ws-1', missing: [] })
		expect(dst.has('/board/photo.png')).toBe(false)
		expect(await dst.fm.connections.list_connections('/board')).toEqual([])
	})

	test('a rerun after a failure resumes into the same workspace without duplicates', async () => {
		const src = await make_source()
		const dst = make_dest()
		const { deps, jobs } = make_deps(dst)
		const run = await make_run(src)

		dst.fail_once('upload_file')
		await expect(run_bridge(deps, run)).rejects.toThrow('injected upload_file failure')
		expect(jobs.get(run.job_key)?.phase).toBe('files')

		const result = await run_bridge(deps, run)

		expect(result).toEqual({ kind: 'done', workspace_id: 'ws-1', missing: [] })
		expect(deps.create_workspace).toHaveBeenCalledTimes(1)
		expect(dst.list_entries().filter(entry => entry.type === 'file').map(entry => entry.path).sort())
			.toEqual(['/board/note.md', '/board/photo.png', '/board/refs/clip.mp4'])
		expect(await dst.fm.strokes.list_strokes('/board')).toHaveLength(1)

		// a finished copy stays as it is; running again makes a new one
		await run_bridge(deps, run)
		expect(deps.create_workspace).toHaveBeenCalledTimes(2)
	})

	test('a plan limit stops the copy and keeps the job resumable', async () => {
		const src = await make_source()
		const dst = make_dest()
		const { deps, jobs } = make_deps(dst)
		const upload = dst.fm.upload_file.bind(dst.fm)
		dst.fm.upload_file = async (folder_id, filename, data, mime, on_progress) => {
			if (filename === 'clip.mp4') {
				throw new PlanLimitError({
					kind: 'quota',
					used_bytes: 100,
					quota_bytes: 100,
					file_bytes: 4096,
					needed_bytes: 4096,
					max_file_bytes: null,
					file_mime: 'video/mp4',
				})
			}
			return upload(folder_id, filename, data, mime, on_progress)
		}
		const run = await make_run(src)

		const result = await run_bridge(deps, run)

		expect(result).toMatchObject({ kind: 'plan_limit', workspace_id: 'ws-1', file: 'board/refs/clip.mp4' })
		expect(jobs.get(run.job_key)?.phase).toBe('files')
	})

	test('an aborted run uploads nothing more and stays resumable', async () => {
		const src = await make_source()
		const dst = make_dest()
		const { deps, jobs } = make_deps(dst)
		const controller = new AbortController()
		controller.abort()
		const run = await make_run(src, { signal: controller.signal })

		const result = await run_bridge(deps, run)

		expect(result).toEqual({ kind: 'aborted', workspace_id: 'ws-1' })
		expect(dst.calls.some(call => call.method === 'upload_file')).toBe(false)
		expect(jobs.get(run.job_key)?.phase).toBe('files')
	})

	test('an unfinished job whose workspace is gone starts a new copy', async () => {
		const src = await make_source()
		const dst = make_dest()
		const { deps, jobs } = make_deps(dst)
		const run = await make_run(src)
		jobs.set(run.job_key, { workspace_id: 'gone', name: 'Workspace', phase: 'files', started_at: 0 })
		deps.workspace_exists = async workspace_id => workspace_id !== 'gone'

		const result = await run_bridge(deps, run)

		expect(result).toEqual({ kind: 'done', workspace_id: 'ws-1', missing: [] })
	})
})

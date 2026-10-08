import { describe, expect, test, vi } from 'vitest'
import {
	createFakeFileManager,
	is_text_mime,
	type FakeFileManager,
	type FileManager,
} from '@pile-commander/file-manager'
import { derived_uuid } from './hash'
import { reconcile, type ReconcileOptions } from './reconcile'
import { create_sync_engine, type SyncStatus } from './syncEngine'
import { is_sync_state_path, new_sync_state, parse_sync_state } from './stateFile'
import {
	MASS_DELETE_MIN,
	conflicted_name,
	run_sync_pass,
	type LocalWriter,
	type SyncPassDeps,
	type SyncPassOptions,
	type SyncReport,
} from './syncPass'
import { SYNC_STATE_VERSION, type BaseEntry, type CloudEntry, type LocalEntry, type SyncState } from './types'

const OPTIONS: ReconcileOptions = { exclude: new Set(), max_file_bytes: 1_000_000 }

function local_file(relative: string, size = 10, mtime_ms = 1): LocalEntry {
	return { relative, id: `/ws/${relative}`, name: relative.split('/').pop()!, kind: 'file', size, mtime_ms, bad_name: false }
}

function local_folder(relative: string): LocalEntry {
	return { relative, id: `/ws/${relative}`, name: relative.split('/').pop()!, kind: 'folder', size: 0, mtime_ms: 0, bad_name: false }
}

function cloud_entry(path: string, id: string, patch: Partial<CloudEntry> = {}): CloudEntry {
	return {
		id,
		parent_id: null,
		path,
		name: path.split('/').pop()!,
		kind: 'file',
		size: 10,
		modified_at: 't1',
		is_blob: false,
		xattrs: {},
		...patch,
	}
}

function base_file(cloud_id: string, patch: Partial<BaseEntry> = {}): BaseEntry {
	return { kind: 'file', size: 10, mtime_ms: 1, cloud_id, cloud_modified_at: 't1', ...patch }
}

function base_folder(cloud_id: string): BaseEntry {
	return { kind: 'folder', size: 0, mtime_ms: 0, cloud_id, cloud_modified_at: null }
}

const ROOT = cloud_entry('/', 'root', { kind: 'folder', name: '', modified_at: null })

describe('reconcile', () => {
	test('creates what is new here, folders before files', () => {
		const plan = reconcile({}, [local_folder('a'), local_file('a/n.md')], [ROOT], OPTIONS)
		expect(plan.actions).toEqual([
			{ kind: 'create_folder', relative: 'a' },
			{ kind: 'upload', relative: 'a/n.md' },
		])
	})

	test('a local edit goes up, a cloud edit comes down, an edit on both sides keeps the cloud name', () => {
		const base = { 'x.md': base_file('cx'), 'y.md': base_file('cy'), 'z.md': base_file('cz') }
		const local = [local_file('x.md', 11), local_file('y.md'), local_file('z.md', 12)]
		const cloud = [
			ROOT,
			cloud_entry('/x.md', 'cx'),
			cloud_entry('/y.md', 'cy', { modified_at: 't2' }),
			cloud_entry('/z.md', 'cz', { modified_at: 't2' }),
		]
		expect(reconcile(base, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'update', relative: 'x.md', cloud_id: 'cx' },
			{ kind: 'download', relative: 'y.md', cloud_id: 'cy' },
			{ kind: 'local_conflict', relative: 'z.md', cloud_id: 'cz' },
		])
	})

	test('trashes what was deleted here, and brings back what changed in the cloud meanwhile', () => {
		const base = { 'x.md': base_file('cx'), 'y.md': base_file('cy') }
		const cloud = [ROOT, cloud_entry('/x.md', 'cx'), cloud_entry('/y.md', 'cy', { modified_at: 't2' })]
		const plan = reconcile(base, [], cloud, OPTIONS)
		expect(plan.actions).toEqual([
			{ kind: 'download', relative: 'y.md', cloud_id: 'cy' },
			{ kind: 'delete', relative: 'x.md', cloud_id: 'cx' },
		])
		expect(plan.deletes).toBe(1)
	})

	test('a folder deleted here comes back when the cloud added to it', () => {
		const base = { a: base_folder('ca'), 'a/x.md': base_file('cx') }
		const cloud = [
			ROOT,
			cloud_entry('/a', 'ca', { kind: 'folder' }),
			cloud_entry('/a/x.md', 'cx'),
			cloud_entry('/a/theirs.md', 'ct'),
		]
		expect(reconcile(base, [], cloud, OPTIONS).actions).toEqual([
			{ kind: 'download_folder', relative: 'a', cloud_id: 'ca' },
			{ kind: 'download', relative: 'a/theirs.md', cloud_id: 'ct' },
			{ kind: 'delete', relative: 'a/x.md', cloud_id: 'cx' },
		])
	})

	test('a file with the same size and mtime under a new name is a move', () => {
		const base = { 'old.md': base_file('c1', { size: 5, mtime_ms: 7 }) }
		const plan = reconcile(base, [local_file('new.md', 5, 7)], [ROOT, cloud_entry('/old.md', 'c1')], OPTIONS)
		expect(plan.actions).toEqual([{ kind: 'move', from: 'old.md', relative: 'new.md', cloud_id: 'c1' }])
	})

	test('a renamed folder moves with its files', () => {
		const base = { a: base_folder('ca'), 'a/x.md': base_file('cx'), 'a/y.png': base_file('cy', { size: 20 }) }
		const local = [local_folder('b'), local_file('b/x.md'), local_file('b/y.png', 20), local_file('b/new.md', 3)]
		const cloud = [ROOT, cloud_entry('/a', 'ca', { kind: 'folder' }), cloud_entry('/a/x.md', 'cx'), cloud_entry('/a/y.png', 'cy', { size: 20 })]
		expect(reconcile(base, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'move', from: 'a', relative: 'b', cloud_id: 'ca' },
			{ kind: 'upload', relative: 'b/new.md' },
		])
	})

	test('an empty folder renamed in place is a move, not a delete and a new folder', () => {
		const base = { 'New folder 1': base_folder('cf'), Ideas: base_folder('ci') }
		const local = [local_folder('Wau1'), local_folder('Ideas')]
		const cloud = [ROOT, cloud_entry('/New folder 1', 'cf', { kind: 'folder' }), cloud_entry('/Ideas', 'ci', { kind: 'folder' })]
		expect(reconcile(base, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'move', from: 'New folder 1', relative: 'Wau1', cloud_id: 'cf' },
		])
	})

	test('an empty folder is not matched when two new folders could be it', () => {
		const base = { old: base_folder('co') }
		const local = [local_folder('a'), local_folder('b')]
		const cloud = [ROOT, cloud_entry('/old', 'co', { kind: 'folder' })]
		expect(reconcile(base, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'create_folder', relative: 'a' },
			{ kind: 'create_folder', relative: 'b' },
			{ kind: 'delete', relative: 'old', cloud_id: 'co' },
		])
	})

	test('adopts what the cloud already holds; a different file there keeps the cloud name', () => {
		const local = [local_file('same.md', 10), local_file('other.md', 99)]
		const cloud = [ROOT, cloud_entry('/same.md', 'c1'), cloud_entry('/other.md', 'c2')]
		expect(reconcile({}, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'adopt', relative: 'same.md', cloud_id: 'c1' },
			{ kind: 'local_conflict', relative: 'other.md', cloud_id: 'c2' },
		])
	})

	test('an earlier copy untouched since the link is overwritten, not copied', () => {
		const cloud = [ROOT, cloud_entry('/n.md', 'c1', { modified_at: '2026-01-01T00:00:00Z' })]
		const plan = reconcile({}, [local_file('n.md', 99)], cloud, {
			...OPTIONS,
			adopt_before: Date.parse('2026-02-01T00:00:00Z'),
		})
		expect(plan.actions).toEqual([{ kind: 'update', relative: 'n.md', cloud_id: 'c1' }])
	})

	test('leaves out refused names, heavy and excluded files, and their subtrees', () => {
		const bad = { ...local_folder('bad\u0001'), bad_name: true }
		const local = [bad, { ...local_file('bad\u0001/x.md'), bad_name: true }, local_file('big.mov', 2_000_000), local_file('skip.md')]
		const plan = reconcile({ 'skip.md': base_file('cs') }, local, [ROOT, cloud_entry('/skip.md', 'cs')], {
			...OPTIONS,
			exclude: new Set(['skip.md']),
		})
		expect(plan.actions).toEqual([
			{ kind: 'skip', relative: 'bad\u0001', reason: 'bad_name' },
			{ kind: 'skip', relative: 'bad\u0001/x.md', reason: 'bad_name' },
			{ kind: 'skip', relative: 'big.mov', reason: 'too_large' },
			{ kind: 'skip', relative: 'skip.md', reason: 'excluded' },
		])
	})

	test('counts the files a folder delete takes along', () => {
		const base: Record<string, BaseEntry> = { a: base_folder('ca') }
		const cloud = [ROOT, cloud_entry('/a', 'ca', { kind: 'folder' })]
		for (let index = 0; index < 5; index++) {
			base[`a/${index}.md`] = base_file(`c${index}`, { size: index })
			cloud.push(cloud_entry(`/a/${index}.md`, `c${index}`, { size: index }))
		}
		const plan = reconcile(base, [], cloud, OPTIONS)
		expect(plan.actions).toEqual([{ kind: 'delete', relative: 'a', cloud_id: 'ca' }])
		expect(plan.deletes).toBe(5)
		expect(plan.local_deletes).toBe(0)
		expect(plan.base_files).toBe(5)
	})
})

describe('reconcile, cloud → here', () => {
	test('a folder renamed in the cloud is renamed here, its files follow without moves of their own', () => {
		const base = { a: base_folder('ca'), 'a/x.md': base_file('cx') }
		const local = [local_folder('a'), local_file('a/x.md')]
		const cloud = [ROOT, cloud_entry('/b', 'ca', { kind: 'folder' }), cloud_entry('/b/x.md', 'cx')]
		expect(reconcile(base, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'local_move', from: 'a', relative: 'b', cloud_id: 'ca' },
		])
	})

	test('a folder deleted in the cloud goes to the trash here whole', () => {
		const base = { f: base_folder('cf'), 'f/x.md': base_file('cx') }
		const plan = reconcile(base, [local_folder('f'), local_file('f/x.md')], [ROOT], OPTIONS)
		expect(plan.actions).toEqual([{ kind: 'local_trash', relative: 'f' }])
		expect(plan.local_deletes).toBe(1)
	})

	test('a folder deleted in the cloud that holds something new here comes back to the cloud', () => {
		const base = { f: base_folder('cf'), 'f/x.md': base_file('cx') }
		const local = [local_folder('f'), local_file('f/x.md'), local_file('f/new.md', 3)]
		expect(reconcile(base, local, [ROOT], OPTIONS).actions).toEqual([
			{ kind: 'create_folder', relative: 'f' },
			{ kind: 'upload', relative: 'f/new.md' },
			{ kind: 'local_trash', relative: 'f/x.md' },
		])
	})

	test('a cloud move onto a path taken here waits', () => {
		const base = { 'a.md': base_file('ca') }
		const local = [local_file('a.md'), local_file('b.md', 3)]
		const cloud = [ROOT, cloud_entry('/b.md', 'ca')]
		// neither moves nor goes up while the cloud path is held by the other file
		expect(reconcile(base, local, cloud, OPTIONS).actions).toEqual([
			{ kind: 'skip', relative: 'a.md', reason: 'occupied' },
			{ kind: 'skip', relative: 'b.md', reason: 'occupied' },
		])
	})

	test('a cloud name this device cannot write stays in the cloud', () => {
		const cloud = [ROOT, cloud_entry('/back\\slash.md', 'c1'), cloud_entry('/fine.md', 'c2')]
		expect(reconcile({}, [], cloud, OPTIONS).actions).toEqual([
			{ kind: 'download', relative: 'fine.md', cloud_id: 'c2' },
		])
	})
})

describe('conflicted_name', () => {
	test('stamps the name and stays unique', () => {
		const date = new Date(2026, 9, 8, 14, 30)
		expect(conflicted_name('note.md', date, new Set())).toBe('note (conflicted copy 2026-10-08 1430).md')
		expect(conflicted_name('note.md', date, new Set(['note (conflicted copy 2026-10-08 1430).md'])))
			.toBe('note (conflicted copy 2026-10-08 1430 2).md')
		expect(conflicted_name('Makefile', date, new Set())).toBe('Makefile (conflicted copy 2026-10-08 1430)')
	})
})

// ---- a pass against fakes --------------------------------------------------

function bytes(size: number): Blob {
	return new Blob([new Uint8Array(size).fill(7)])
}

/** A cloud workspace over the fake: stable ids that follow moves, content mtimes. */
function make_cloud() {
	const fake = createFakeFileManager()
	fake.seed_folder('/')
	const ids = new Map<string, string>([['/', 'root']])
	const mtimes = new Map<string, string>()
	let counter = 0
	const touch = (path: string) => mtimes.set(path, `t${++counter}`)
	const rekey = (from: string, to: string) => {
		for (const map of [ids, mtimes] as Map<string, string>[]) {
			for (const [path, value] of [...map]) {
				if (path !== from && !path.startsWith(`${from}/`)) continue
				map.delete(path)
				map.set(to + path.slice(from.length), value)
			}
		}
	}
	const fm: FileManager = {
		...fake.fm,
		async create_folder(folder, name, options) {
			const child = await fake.fm.create_folder(folder, name, options)
			ids.set(child.id, `c${++counter}`)
			return child
		},
		// text goes to the text column, as in the real cloud
		async upload_file(folder, name, data, mime, progress) {
			const child = mime && is_text_mime(mime)
				? await fake.fm.create_text_file(folder, name, { content: await data.text() })
				: await fake.fm.upload_file(folder, name, data, mime, progress)
			ids.set(child.id, `c${++counter}`)
			touch(child.id)
			return child
		},
		async save_text_file(id, content) {
			await fake.fm.save_text_file(id, content)
			touch(id)
		},
		async rename(id, name) {
			const patch = await fake.fm.rename(id, name)
			rekey(id, patch.id)
			return patch
		},
		async move(id, target, name) {
			const patch = await fake.fm.move(id, target, name)
			rekey(id, patch.id)
			return patch
		},
	}
	const list_cloud = vi.fn(async (): Promise<CloudEntry[]> => Promise.all(
		fake.list_entries().map(async snapshot => ({
			id: ids.get(snapshot.path) ?? `seed:${snapshot.path}`,
			parent_id: null,
			path: snapshot.path,
			name: snapshot.path === '/' ? '' : snapshot.path.slice(snapshot.path.lastIndexOf('/') + 1),
			kind: snapshot.type,
			size: await fake.fm.entry_size(snapshot.path),
			modified_at: snapshot.type === 'file' ? mtimes.get(snapshot.path) ?? 't0' : null,
			is_blob: snapshot.has_blob,
			xattrs: snapshot.xattrs,
		})),
	))
	/** An edit made in the cloud by someone else. */
	const edit = async (path: string, content: string) => {
		await fake.fm.save_text_file(path, content)
		touch(path)
	}
	return { fake, fm, list_cloud, ids, edit }
}

function make_local() {
	const local = createFakeFileManager()
	local.seed_folder('/ws')
	const mtimes = new Map<string, number>()
	const stat = async (id: string) => ({ size: await local.fm.entry_size(id), mtime_ms: mtimes.get(id) ?? 1 })
	return { local, mtimes, stat }
}

function new_state(): SyncState {
	return {
		version: SYNC_STATE_VERSION,
		workspace_id: 'ws-1',
		user_id: 'user-1',
		device_id: 'device-1',
		root_path: '/ws',
		exclude: [],
		entries: {},
		layout: {},
	}
}

/** Downloads land through the fake's upload (a new entry, xattrs dropped — like a rename over the file). */
function make_writer(local: FakeFileManager) {
	const trashed: string[] = []
	const writer: LocalWriter = {
		async write_file(folder, name, data) {
			await local.fm.upload_file(folder, name, data)
		},
		async trash(path) {
			trashed.push(path)
			await local.fm.remove(path)
		},
	}
	return { writer, trashed }
}

function make_deps(local: FakeFileManager, stat: SyncPassDeps['stat'], cloud: ReturnType<typeof make_cloud>) {
	const purge = vi.fn(async () => {})
	const { writer, trashed } = make_writer(local)
	const saved_progress: SyncState[] = []
	const deps: SyncPassDeps = {
		local_fm: local.fm,
		root: '/ws',
		stat,
		writer,
		save_progress: async (state) => {
			saved_progress.push(state)
		},
		cloud_fm: cloud.fm,
		list_cloud: cloud.list_cloud,
		purge,
		now: () => new Date(2026, 9, 8, 14, 30),
	}
	return { deps, purge, trashed, saved_progress }
}

async function pass(deps: SyncPassDeps, state: SyncState, options: Omit<SyncPassOptions, 'max_file_bytes'> = {}) {
	const result = await run_sync_pass(deps, state, { max_file_bytes: 1_000_000, ...options })
	if (result.kind !== 'done') throw new Error(`pass ended with ${result.kind}`)
	return result
}

/** A pass that reads the cloud, as on a cloud event or the interval. */
function cloud_pass(deps: SyncPassDeps, state: SyncState, options: Omit<SyncPassOptions, 'max_file_bytes'> = {}) {
	return pass(deps, state, { check_cloud: true, ...options })
}

/** Text of a file here, whether the fake holds it as text or as bytes. */
async function local_text(local: FakeFileManager, path: string): Promise<string> {
	return (await local.get_blob(path)?.text()) ?? local.fm.read_text_file(path)
}

/** The pass found nothing to do on either side. */
function expect_quiet(report: SyncReport) {
	expect(report).toMatchObject({ uploaded: 0, updated: 0, downloaded: 0, moved: 0, deleted: 0, trashed: 0, conflicts: [], errors: [] })
}

describe('run_sync_pass', () => {
	test('pushes a folder, then stays quiet until something changes here', async () => {
		const { local, stat } = make_local()
		local.seed_folder('/ws/board')
		local.seed_file('/ws/board/note.md', '# hello')
		await local.fm.upload_file('/ws/board', 'photo.png', bytes(64), 'image/png')
		local.set_xattr('/ws/board/note.md', 'position', '{"x":1,"y":2}')
		local.set_xattr('/ws', 'view', 'board')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)

		const first = await pass(deps, new_state())

		expect(first.report.uploaded).toBe(2)
		expect(cloud.fake.has('/board/note.md')).toBe(true)
		expect(cloud.fake.get_blob('/board/photo.png')?.size).toBe(64)
		expect(cloud.fake.get_xattr('/board/note.md', 'position')).toBe('{"x":1,"y":2}')
		expect(cloud.fake.get_xattr('/', 'view')).toBe('board')
		expect(Object.keys(first.state.entries).sort()).toEqual(['board', 'board/note.md', 'board/photo.png'])

		cloud.list_cloud.mockClear()
		const second = await run_sync_pass(deps, first.state, { max_file_bytes: 1_000_000 })
		expect(second.kind).toBe('unchanged')
		expect(cloud.list_cloud).not.toHaveBeenCalled()
	})

	test('updates the same cloud file instead of making another copy', async () => {
		const { local, stat, mtimes } = make_local()
		local.seed_file('/ws/note.md', 'one')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())
		const id = cloud.ids.get('/note.md')

		await local.fm.save_text_file('/ws/note.md', 'one, two')
		mtimes.set('/ws/note.md', 2)
		const second = await pass(deps, first.state)

		expect(second.report.updated).toBe(1)
		expect(await cloud.fm.read_text_file('/note.md')).toBe('one, two')
		expect(cloud.ids.get('/note.md')).toBe(id)
		expect(cloud.fake.list_entries().map(entry => entry.path).sort()).toEqual(['/', '/note.md'])
	})

	test('replaces a changed binary file and purges the old row', async () => {
		const { local, stat, mtimes } = make_local()
		await local.fm.upload_file('/ws', 'photo.png', bytes(10), 'image/png')
		local.set_xattr('/ws/photo.png', 'position', '{"x":5,"y":5}')
		const cloud = make_cloud()
		const { deps, purge } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())
		const old_id = first.state.entries['photo.png']!.cloud_id

		await local.fm.upload_file('/ws', 'photo.png', bytes(30), 'image/png')
		// a write on disk keeps the xattrs; the fake starts the entry over
		local.set_xattr('/ws/photo.png', 'position', '{"x":5,"y":5}')
		mtimes.set('/ws/photo.png', 2)
		const second = await pass(deps, first.state)

		expect(purge).toHaveBeenCalledWith(old_id)
		expect(cloud.fake.get_blob('/photo.png')?.size).toBe(30)
		expect(cloud.fake.get_xattr('/photo.png', 'position')).toBe('{"x":5,"y":5}')
		expect(second.state.entries['photo.png']!.cloud_id).not.toBe(old_id)
	})

	test('replaces a binary file in place when the backend can', async () => {
		const { local, stat, mtimes } = make_local()
		await local.fm.upload_file('/ws', 'photo.png', bytes(10), 'image/png')
		local.set_xattr('/ws/photo.png', 'position', '{"x":5,"y":5}')
		local.seed_connections('/ws', [{
			id: '/ws/photo.png:default-/ws/photo.png:default',
			from: '/ws/photo.png',
			to: '/ws/photo.png',
			is_animated: false,
		}])
		const cloud = make_cloud()
		const { deps, purge } = make_deps(local, stat, cloud)
		deps.replace_blob = async (cloud_path, blob, mime) => {
			const saved = cloud.fake.list_entries().find(entry => entry.path === cloud_path)?.xattrs ?? {}
			const slash = cloud_path.lastIndexOf('/')
			await cloud.fake.fm.upload_file(cloud_path.slice(0, slash) || '/', cloud_path.slice(slash + 1), blob, mime)
			for (const [name, value] of Object.entries(saved)) cloud.fake.set_xattr(cloud_path, name, value)
			return 'replaced'
		}
		const set_xattrs = vi.spyOn(cloud.fm, 'set_xattrs')
		const upsert = vi.spyOn(cloud.fm.connections, 'upsert_connections')
		const first = await pass(deps, new_state())
		const cloud_id = first.state.entries['photo.png']!.cloud_id
		expect(upsert).toHaveBeenCalled()

		await local.fm.upload_file('/ws', 'photo.png', bytes(30), 'image/png')
		local.set_xattr('/ws/photo.png', 'position', '{"x":5,"y":5}')
		mtimes.set('/ws/photo.png', 2)
		set_xattrs.mockClear()
		upsert.mockClear()
		purge.mockClear()
		const upload = vi.spyOn(cloud.fm, 'upload_file')
		const second = await pass(deps, first.state)

		expect(second.report.updated).toBe(1)
		expect(second.state.entries['photo.png']!.cloud_id).toBe(cloud_id)
		expect(cloud.fake.get_blob('/photo.png')?.size).toBe(30)
		expect(purge).not.toHaveBeenCalled()
		expect(upload).not.toHaveBeenCalled()
		expect(set_xattrs).not.toHaveBeenCalled()
		expect(upsert).not.toHaveBeenCalled()
	})

	test('an unsupported replace uploads the file once through the old path', async () => {
		const { local, stat, mtimes } = make_local()
		await local.fm.upload_file('/ws', 'photo.png', bytes(10), 'image/png')
		const cloud = make_cloud()
		const { deps, purge } = make_deps(local, stat, cloud)
		deps.replace_blob = async () => 'unsupported'
		const first = await pass(deps, new_state())
		const old_id = first.state.entries['photo.png']!.cloud_id

		await local.fm.upload_file('/ws', 'photo.png', bytes(30), 'image/png')
		mtimes.set('/ws/photo.png', 2)
		const upload = vi.spyOn(cloud.fm, 'upload_file')
		const second = await pass(deps, first.state)

		expect(upload).toHaveBeenCalledTimes(1)
		expect(purge).toHaveBeenCalledWith(old_id)
		expect(second.state.entries['photo.png']!.cloud_id).not.toBe(old_id)
		expect(cloud.fake.get_blob('/photo.png')?.size).toBe(30)
	})

	test('follows a rename here with a rename in the cloud', async () => {
		const { local, stat } = make_local()
		local.seed_folder('/ws/a')
		local.seed_file('/ws/a/x.md', 'x')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())
		const folder_id = cloud.ids.get('/a')

		await local.fm.rename('/ws/a', 'b')
		const second = await pass(deps, first.state)

		expect(second.report.moved).toBe(1)
		expect(cloud.ids.get('/b')).toBe(folder_id)
		expect(cloud.fake.has('/b/x.md')).toBe(true)
		expect(cloud.fake.has('/a')).toBe(false)
		expect(Object.keys(second.state.entries).sort()).toEqual(['b', 'b/x.md'])
	})

	test('renaming an empty folder renames it in the cloud too', async () => {
		const { local, stat } = make_local()
		local.seed_folder('/ws/New folder 1')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())
		const id = cloud.ids.get('/New folder 1')
		const remove = vi.spyOn(cloud.fm, 'remove')

		await local.fm.rename('/ws/New folder 1', 'Wau1')
		const second = await pass(deps, first.state)

		expect(second.report.moved).toBe(1)
		expect(remove).not.toHaveBeenCalled()
		expect(cloud.ids.get('/Wau1')).toBe(id)
		expect(cloud.fake.has('/New folder 1')).toBe(false)
	})

	test('a file edited on both sides keeps the cloud version under its name on both sides', async () => {
		const { local, stat, mtimes } = make_local()
		local.seed_file('/ws/note.md', 'base')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())
		const id = cloud.ids.get('/note.md')

		await cloud.edit('/note.md', 'theirs')
		await local.fm.save_text_file('/ws/note.md', 'mine')
		mtimes.set('/ws/note.md', 2)
		const second = await pass(deps, first.state)

		const copy = 'note (conflicted copy 2026-10-08 1430).md'
		expect(second.report.conflicts).toEqual(['note.md'])
		expect(await cloud.fm.read_text_file('/note.md')).toBe('theirs')
		expect(cloud.ids.get('/note.md')).toBe(id)
		expect(await cloud.fm.read_text_file(`/${copy}`)).toBe('mine')
		expect(await local_text(local, '/ws/note.md')).toBe('theirs')
		expect(await local_text(local, `/ws/${copy}`)).toBe('mine')
		expect(second.state.entries['note.md']!.cloud_id).toBe(id)

		// both sides now hold the same two files: nothing more to do
		expect_quiet((await cloud_pass(deps, second.state)).report)

		// the name follows the cloud version from now on
		await local.fm.save_text_file('/ws/note.md', 'theirs, edited here')
		mtimes.set('/ws/note.md', 3)
		const third = await pass(deps, second.state)
		expect(third.report.conflicts).toEqual([])
		expect(await cloud.fm.read_text_file('/note.md')).toBe('theirs, edited here')
	})

	test('trashes deleted files, and asks before trashing most of the copy', async () => {
		const { local, stat } = make_local()
		for (let index = 0; index <= MASS_DELETE_MIN; index++) local.seed_file(`/ws/${index}.md`, 'x'.repeat(index + 1))
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())

		await local.fm.remove('/ws/0.md')
		const second = await pass(deps, first.state)
		expect(second.report.deleted).toBe(1)
		expect(cloud.fake.has('/0.md')).toBe(false)

		for (let index = 1; index <= MASS_DELETE_MIN; index++) await local.fm.remove(`/ws/${index}.md`)
		const paused = await run_sync_pass(deps, second.state, { max_file_bytes: 1_000_000 })
		expect(paused).toEqual({ kind: 'mass_delete', side: 'cloud', deletes: MASS_DELETE_MIN, base_files: MASS_DELETE_MIN })
		expect(cloud.fake.has('/1.md')).toBe(true)

		const confirmed = await pass(deps, second.state, { allow_cloud_deletes: true })
		expect(confirmed.report.deleted).toBe(MASS_DELETE_MIN)
		expect(cloud.fake.list_entries().map(entry => entry.path)).toEqual(['/'])
	})

	test('pushes ink under derived ids and edges onto cloud paths', async () => {
		const { local, stat } = make_local()
		local.seed_folder('/ws/board')
		local.seed_file('/ws/board/a.md', 'a')
		local.seed_file('/ws/board/b.md', 'b')
		local.seed_strokes('/ws/board', [{
			id: 'ink-1',
			z: 1,
			position: { x: 0, y: 0 },
			points: [{ x: 0, y: 0 }],
			color: '#000',
			stroke_width: 2,
			width: 4,
			height: 4,
		}])
		local.seed_connections('/ws/board', [{
			id: '/ws/board/a.md:default-/ws/board/b.md:default',
			from: '/ws/board/a.md',
			to: '/ws/board/b.md',
			is_animated: false,
		}])
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)

		const first = await pass(deps, new_state())

		const strokes = await cloud.fm.strokes.list_strokes('/board')
		expect(strokes.map(stroke => stroke.id)).toEqual([await derived_uuid('ws-1', 'ink-1')])
		const edges = await cloud.fm.connections.list_connections('/board')
		expect(edges.map(edge => [edge.id, edge.from, edge.to])).toEqual([
			['/board/a.md:default-/board/b.md:default', '/board/a.md', '/board/b.md'],
		])

		// the ink is erased here: it goes in the cloud too
		local.seed_strokes('/ws/board', [])
		await pass(deps, first.state)
		expect(await cloud.fm.strokes.list_strokes('/board')).toEqual([])
	})

	test('a resumed first pass adopts what already went up', async () => {
		const { local, stat } = make_local()
		local.seed_file('/ws/note.md', 'same')
		const cloud = make_cloud()
		await cloud.fm.upload_file('/', 'note.md', new Blob(['same']), 'text/markdown')
		const upload = vi.spyOn(cloud.fm, 'upload_file')
		const { deps } = make_deps(local, stat, cloud)

		const result = await pass(deps, new_state())

		expect(upload).not.toHaveBeenCalled()
		expect(result.state.entries['note.md']?.cloud_id).toBe(cloud.ids.get('/note.md'))
	})
})

describe('sync state file', () => {
	const owner = { root_path: '/ws', device_id: 'device-1', user_id: 'user-1', workspace_id: 'ws-1' }

	test('reads back what it wrote', () => {
		const state = new_sync_state(owner, { exclude: ['big.mov'], adopt_before: 5 })
		expect(parse_sync_state(JSON.stringify(state), owner)).toEqual(state)
	})

	test('a folder copied elsewhere or to another device is not linked', () => {
		const text = JSON.stringify(new_sync_state(owner))
		expect(parse_sync_state(text, { ...owner, root_path: '/copy' })).toBeNull()
		expect(parse_sync_state(text, { ...owner, device_id: 'device-2' })).toBeNull()
		expect(parse_sync_state(text, { ...owner, user_id: 'user-2' })).toBeNull()
		expect(parse_sync_state('{broken', owner)).toBeNull()
	})

	test('its own writes do not wake the watcher', () => {
		expect(is_sync_state_path('/ws/.pile/sync.json')).toBe(true)
		expect(is_sync_state_path('C:\\ws\\.pile\\sync.json.tmp')).toBe(true)
		expect(is_sync_state_path('/ws/board/.pile/sync-3f2a.tmp')).toBe(true)
		expect(is_sync_state_path('/ws/.pile/strokes.json')).toBe(false)
		expect(is_sync_state_path('/ws/sync.json')).toBe(false)
	})
})

describe('sync engine', () => {
	test('syncs at start and after changes settle, and pauses before a mass delete', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
		try {
			const { local, stat } = make_local()
			for (let index = 0; index < MASS_DELETE_MIN; index++) local.seed_file(`/ws/${index}.md`, 'x'.repeat(index + 1))
			const cloud = make_cloud()
			const { deps } = make_deps(local, stat, cloud)
			let saved: SyncState = new_state()
			let on_change = () => {}
			const statuses: SyncStatus[] = []
			const engine = create_sync_engine({
				load_state: async () => saved,
				save_state: async (state) => {
					saved = state
				},
				pass_deps: () => deps,
				max_file_bytes: () => 1_000_000,
				watch: async (callback) => {
					on_change = callback
					return () => {}
				},
				on_status: status => statuses.push(status),
			}, { debounce_ms: 100, interval_ms: 60_000, retry_ms: [1_000] })

			await engine.start()
			expect(statuses.at(-1)?.phase).toBe('idle')
			expect(Object.keys(saved.entries)).toHaveLength(MASS_DELETE_MIN)

			local.seed_file('/ws/new.md', 'new')
			on_change()
			await vi.advanceTimersByTimeAsync(150)
			await vi.waitFor(() => expect(cloud.fake.has('/new.md')).toBe(true))
			await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe('idle'))

			for (let index = 0; index < MASS_DELETE_MIN; index++) await local.fm.remove(`/ws/${index}.md`)
			on_change()
			await vi.advanceTimersByTimeAsync(150)
			await vi.waitFor(() => expect(statuses.at(-1)).toMatchObject({
				phase: 'paused',
				reason: 'mass_delete_cloud',
				pending_deletes: MASS_DELETE_MIN,
			}))
			expect(cloud.fake.has('/0.md')).toBe(true)

			await engine.sync_now({ allow_cloud_deletes: true })
			expect(statuses.at(-1)?.phase).toBe('idle')
			expect(cloud.fake.has('/0.md')).toBe(false)
			engine.stop()
		} finally {
			vi.useRealTimers()
		}
	})

	test('a failed pass is retried', async () => {
		vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
		try {
			const { local, stat } = make_local()
			local.seed_file('/ws/note.md', 'x')
			const cloud = make_cloud()
			const { deps } = make_deps(local, stat, cloud)
			cloud.list_cloud.mockRejectedValueOnce(new Error('offline'))
			const statuses: SyncStatus[] = []
			const engine = create_sync_engine({
				load_state: async () => new_state(),
				save_state: async () => {},
				pass_deps: () => deps,
				max_file_bytes: () => 1_000_000,
				watch: async () => () => {},
				on_status: status => statuses.push(status),
			}, { debounce_ms: 100, interval_ms: 60_000, retry_ms: [1_000] })

			await engine.start()
			expect(statuses.at(-1)).toMatchObject({ phase: 'error', message: 'offline' })
			await vi.advanceTimersByTimeAsync(1_100)
			await vi.waitFor(() => expect(statuses.at(-1)?.phase).toBe('idle'))
			expect(cloud.fake.has('/note.md')).toBe(true)
			engine.stop()
		} finally {
			vi.useRealTimers()
		}
	})
})

describe('two-way pass', () => {
	test('a note edited in the cloud comes down, and the next pass finds nothing to do', async () => {
		const { local, stat } = make_local()
		local.seed_file('/ws/note.md', 'mine')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())

		await cloud.edit('/note.md', 'edited in the web')
		// nothing changed here and the cloud was not asked: no pass
		expect((await run_sync_pass(deps, first.state, { max_file_bytes: 1_000_000 })).kind).toBe('unchanged')

		const second = await cloud_pass(deps, first.state)
		expect(second.report.downloaded).toBe(1)
		expect(await local_text(local, '/ws/note.md')).toBe('edited in the web')
		expect_quiet((await cloud_pass(deps, second.state)).report)
		expect((await run_sync_pass(deps, second.state, { max_file_bytes: 1_000_000 })).kind).toBe('unchanged')
	})

	test('new cloud folders and files come down with their layout', async () => {
		const { local, stat } = make_local()
		const cloud = make_cloud()
		await cloud.fm.create_folder('/', 'board', { xattrs: { view: 'board' } })
		await cloud.fm.upload_file('/board', 'photo.png', bytes(64), 'image/png')
		cloud.fake.set_xattr('/board/photo.png', 'position', '{"x":3,"y":4}')
		const { deps } = make_deps(local, stat, cloud)

		const first = await cloud_pass(deps, new_state())

		expect(first.report.downloaded).toBe(1)
		expect(local.get_xattr('/ws/board', 'view')).toBe('board')
		expect(local.get_blob('/ws/board/photo.png')?.size).toBe(64)
		expect(local.get_xattr('/ws/board/photo.png', 'position')).toBe('{"x":3,"y":4}')
		// the layout that came down is not pushed back
		expect_quiet((await cloud_pass(deps, first.state)).report)
		expect(cloud.fake.get_xattr('/board/photo.png', 'position')).toBe('{"x":3,"y":4}')
	})

	test('a rename in the cloud renames the folder here', async () => {
		const { local, stat } = make_local()
		local.seed_folder('/ws/a')
		local.seed_file('/ws/a/x.md', 'x')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())
		const id = cloud.ids.get('/a')

		await cloud.fm.rename('/a', 'b')
		const second = await cloud_pass(deps, first.state)

		expect(second.report.moved).toBe(1)
		expect(local.has('/ws/b/x.md')).toBe(true)
		expect(local.has('/ws/a')).toBe(false)
		expect(second.state.entries.b?.cloud_id).toBe(id)
		expect(Object.keys(second.state.entries).sort()).toEqual(['b', 'b/x.md'])
		expect_quiet((await cloud_pass(deps, second.state)).report)
	})

	test('deleted in the cloud: the file here goes to the trash, unless it was edited here', async () => {
		const { local, stat, mtimes } = make_local()
		local.seed_file('/ws/old.md', 'old')
		local.seed_file('/ws/kept.md', 'kept')
		const cloud = make_cloud()
		const { deps, trashed } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())

		await cloud.fm.remove('/old.md')
		await cloud.fm.remove('/kept.md')
		await local.fm.save_text_file('/ws/kept.md', 'kept and edited')
		mtimes.set('/ws/kept.md', 2)
		const second = await cloud_pass(deps, first.state)

		expect(trashed).toEqual(['/ws/old.md'])
		expect(second.report.trashed).toBe(1)
		expect(await cloud.fm.read_text_file('/kept.md')).toBe('kept and edited')
		expect(Object.keys(second.state.entries)).toEqual(['kept.md'])
	})

	test('a conflict interrupted after the rename does not trash the cloud version', async () => {
		const { local, stat, mtimes } = make_local()
		local.seed_file('/ws/note.md', 'base')
		const cloud = make_cloud()
		const { deps, saved_progress } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())

		await cloud.edit('/note.md', 'theirs')
		await local.fm.save_text_file('/ws/note.md', 'mine')
		mtimes.set('/ws/note.md', 2)
		// the process dies while the conflicted copy goes up
		vi.spyOn(cloud.fm, 'upload_file').mockRejectedValueOnce(new Error('killed'))
		await pass(deps, first.state)
		const interrupted = saved_progress.at(-1)!
		expect(interrupted.entries['note.md']).toBeUndefined()

		const resumed = await cloud_pass(deps, interrupted)

		const copy = 'note (conflicted copy 2026-10-08 1430).md'
		expect(resumed.report.deleted).toBe(0)
		expect(await cloud.fm.read_text_file('/note.md')).toBe('theirs')
		expect(await local_text(local, '/ws/note.md')).toBe('theirs')
		expect(await cloud.fm.read_text_file(`/${copy}`)).toBe('mine')
	})

	test('deleted here but edited in the cloud: the cloud version comes back', async () => {
		const { local, stat } = make_local()
		local.seed_file('/ws/note.md', 'base')
		const cloud = make_cloud()
		const { deps } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())

		await local.fm.remove('/ws/note.md')
		await cloud.edit('/note.md', 'edited in the web')
		const second = await cloud_pass(deps, first.state)

		expect(second.report.deleted).toBe(0)
		expect(await local_text(local, '/ws/note.md')).toBe('edited in the web')
	})

	test('asks before trashing most of the folder when the cloud workspace was emptied', async () => {
		const { local, stat } = make_local()
		for (let index = 0; index < MASS_DELETE_MIN; index++) local.seed_file(`/ws/${index}.md`, 'x'.repeat(index + 1))
		const cloud = make_cloud()
		const { deps, trashed } = make_deps(local, stat, cloud)
		const first = await pass(deps, new_state())

		for (let index = 0; index < MASS_DELETE_MIN; index++) await cloud.fm.remove(`/${index}.md`)
		const paused = await run_sync_pass(deps, first.state, { max_file_bytes: 1_000_000, check_cloud: true })
		expect(paused).toEqual({ kind: 'mass_delete', side: 'local', deletes: MASS_DELETE_MIN, base_files: MASS_DELETE_MIN })
		expect(trashed).toEqual([])

		// confirming the cloud side does not confirm this one
		const still = await run_sync_pass(deps, first.state, { max_file_bytes: 1_000_000, check_cloud: true, allow_cloud_deletes: true })
		expect(still.kind).toBe('mass_delete')

		const confirmed = await cloud_pass(deps, first.state, { allow_local_deletes: true })
		expect(confirmed.report.trashed).toBe(MASS_DELETE_MIN)
		expect(trashed).toHaveLength(MASS_DELETE_MIN)
	})

	test('an empty folder on a second computer downloads the whole workspace', async () => {
		const { local, stat } = make_local()
		const cloud = make_cloud()
		await cloud.fm.create_folder('/', 'a')
		await cloud.fm.create_text_file('/a', 'note.md', { content: 'hello' })
		await cloud.fm.upload_file('/', 'photo.png', bytes(10), 'image/png')
		const { deps } = make_deps(local, stat, cloud)
		const upload = vi.spyOn(cloud.fm, 'upload_file')

		const first = await cloud_pass(deps, new_state())

		expect(first.report.downloaded).toBe(2)
		expect(upload).not.toHaveBeenCalled()
		expect(await local_text(local, '/ws/a/note.md')).toBe('hello')
		expect(Object.keys(first.state.entries).sort()).toEqual(['a', 'a/note.md', 'photo.png'])
		expect_quiet((await cloud_pass(deps, first.state)).report)
	})

	test('saves its progress as it goes', async () => {
		const { local, stat } = make_local()
		const cloud = make_cloud()
		await cloud.fm.create_folder('/', 'a')
		await cloud.fm.upload_file('/a', 'photo.png', bytes(10), 'image/png')
		const { deps, saved_progress } = make_deps(local, stat, cloud)

		await cloud_pass(deps, new_state())

		// the folder at once; the download follows within the 2 s throttle or at the end
		expect(saved_progress.length).toBeGreaterThan(0)
		expect(Object.keys(saved_progress[0]!.entries)).toEqual(['a'])
	})
})

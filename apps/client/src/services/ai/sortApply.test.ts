import { describe, expect, test } from 'vitest'
import { TILE } from '@/services/board/layout'
import { apply_sort_plan } from './sortApply'

type Entry = { id: string; name: string; type: 'file' | 'folder'; xattrs: { name: string; value: string }[]; children?: Entry[] }

/** A board folder that names new folders like the app: the first free "New folder N". */
function store(options: { move_fails?: string } = {}) {
	const at = (x: number, y: number) => [{ name: 'position', value: JSON.stringify({ x, y }) }]
	const folder: Entry = {
		id: '/f',
		name: 'f',
		type: 'folder',
		xattrs: [{ name: 'view', value: 'board' }],
		children: [
			{ id: '/f/a.jpg', name: 'a.jpg', type: 'file', xattrs: at(100, 200) },
			{ id: '/f/b.jpg', name: 'b.jpg', type: 'file', xattrs: at(300, 260) },
			{ id: '/f/c.md', name: 'c.md', type: 'file', xattrs: at(500, 40) },
			{ id: '/f/Old', name: 'Old', type: 'folder', xattrs: at(700, 40), children: [{ id: '/f/Old/x', name: 'x', type: 'file', xattrs: [] }] },
		],
	}
	const calls: string[] = []
	let batched = false
	const ws = {
		preview_folders: {},
		resolve_folder_data: (id: string) => (id === '/f' ? folder : folder.children!.find(child => child.id === id) ?? null),
		async run_batch_fs_update<T>(fn: () => Promise<T>) {
			batched = true
			try {
				return await fn()
			} finally {
				batched = false
			}
		},
		async create_folder(parent: string, position?: { x: number; y: number }, opts?: { view?: string; tx?: unknown }) {
			let n = 1
			while (folder.children!.some(child => child.name === `New folder ${n}`)) n++
			const id = `${parent}/New folder ${n}`
			folder.children!.push({ id, name: `New folder ${n}`, type: 'folder', xattrs: [], children: [] })
			calls.push(`create ${JSON.stringify(position ?? null)} view=${opts?.view} ${opts?.tx ? 'tx' : ''} batched=${batched}`)
			return id
		},
		async rename(id: string, name: string, opts?: { tx?: unknown }) {
			const entry = folder.children!.find(child => child.id === id)!
			calls.push(`rename ${entry.name} → ${name} ${opts?.tx ? 'tx' : ''}`)
			entry.name = name
			entry.id = `/f/${name}`
			return entry.id
		},
		async move(id: string, target: string, index: number, source?: string, _source_index?: number, opts?: { tx?: unknown }) {
			if (options.move_fails === id) throw new Error('locked')
			calls.push(`move ${id} → ${target} @${index} from ${source} ${opts?.tx ? 'tx' : ''}`)
			return `${target}/${id.split('/').pop()}`
		},
		async change_position(id: string, position: { x: number; y: number }) {
			calls.push(`place ${id} ${position.x},${position.y}`)
		},
		async ensure_preview_folder() {},
		async reload_folder_cache(id: string) {
			calls.push(`reload ${id}`)
		},
	}
	return { ws: ws as never, calls }
}

describe('apply_sort_plan', () => {
	test('new folders are all made before any is named, where their items stood; items keep their layout inside', async () => {
		const { ws, calls } = store()
		const tx = {} as never
		const outcome = await apply_sort_plan(ws, '/f', [
			{ name: 'Photos', existing_id: null, entry_ids: ['/f/a.jpg', '/f/b.jpg'] },
			{ name: 'Notes', existing_id: null, entry_ids: ['/f/c.md'] },
			{ name: 'Old', existing_id: '/f/Old', entry_ids: [] },
		], tx)

		expect(calls.slice(0, 4)).toEqual([
			'create {"x":100,"y":200} view=board tx batched=true',
			'create {"x":500,"y":40} view=board tx batched=true',
			'rename New folder 1 → Photos tx',
			'rename New folder 2 → Notes tx',
		])
		expect(calls).toContain('move /f/a.jpg → /f/Photos @0 from /f tx')
		expect(calls).toContain(`place /f/Photos/a.jpg ${TILE.pad},${TILE.pad}`)
		expect(calls).toContain(`place /f/Photos/b.jpg ${200 + TILE.pad},${60 + TILE.pad}`)
		expect(calls.slice(-4)).toEqual(['reload /f', 'reload /f/Photos', 'reload /f/Notes', 'reload /f/Old'])
		expect(outcome.folders).toEqual([
			{ id: '/f/Photos', name: 'Photos', created: true },
			{ id: '/f/Notes', name: 'Notes', created: true },
			{ id: '/f/Old', name: 'Old', created: false },
		])
		expect(outcome.moved.get('/f/c.md')).toEqual({ id: '/f/Notes/c.md' })
	})

	test('an existing folder takes items after what it holds, without new places', async () => {
		const { ws, calls } = store()
		await apply_sort_plan(ws, '/f', [{ name: 'Old', existing_id: '/f/Old', entry_ids: ['/f/c.md'] }])
		expect(calls).toContain('move /f/c.md → /f/Old @1 from /f ')
		expect(calls.some(call => call.startsWith('place'))).toBe(false)
	})

	test('a name taken by a file is numbered; a move that fails is reported, the rest go on', async () => {
		const { ws, calls } = store({ move_fails: '/f/a.jpg' })
		const outcome = await apply_sort_plan(ws, '/f', [{ name: 'c.md', existing_id: null, entry_ids: ['/f/a.jpg', '/f/b.jpg'] }])
		expect(calls).toContain('rename New folder 1 → c (1).md ')
		expect(outcome.moved.get('/f/a.jpg')).toEqual({ error: 'locked' })
		expect(outcome.moved.get('/f/b.jpg')).toEqual({ id: '/f/c (1).md/b.jpg' })
	})
})

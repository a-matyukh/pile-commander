import { describe, expect, test, vi } from 'vitest'
import { computed } from 'vue'
import type { FileManager, FolderConnection } from '@pile-commander/file-manager'
import type { Connection } from '@/domain/Widget'
import { create_history, type HistoryEvent, type TransactMeta } from './history'
import type { HistoryTarget } from './steps'
import type { DeleteStep, HistoryStep } from './types'

/** A store whose attributes, texts and edges live in maps: what is "there now" for the history */
function make_target() {
	const attrs = new Map<string, string | null>()
	const texts = new Map<string, string>()
	const edges = new Map<string, Connection>()
	const paths = new Set<string>()
	const writes: string[] = []
	/** Where the next move lands instead of where it was asked to (a clashing name) */
	let land_at: string | null = null
	const parent = (path: string) => path.slice(0, path.lastIndexOf('/')) || '/'
	const key = (id: string, name: string) => `${id}\0${name}`
	const fm = {
		get_xattr: async (id: string, name: string) => attrs.get(key(id, name)) ?? null,
		read_text_file: async (id: string) => texts.get(id) ?? '',
		connections: { list_connections: async () => [...edges.values()] as FolderConnection[] },
		strokes: { list_strokes: async () => [] },
		folder_with_children_xattrs: async (id: string) => ({ id, name: 'f', type: 'folder', xattrs: [], children: [] }),
		FolderChildren: async (folder: string) => [...paths]
			.filter(path => parent(path) === folder)
			.map(id => ({ id, name: id.slice(id.lastIndexOf('/') + 1), type: 'file' })),
	} as unknown as FileManager
	let fail_writes = false
	/** What the trash holds, by ticket: the paths of a removed subtree */
	const trash = new Map<string, string[]>()
	let tickets = 0
	const restores: string[] = []
	const to_trash = (id: string) => {
		const held = [...paths].filter(path => path === id || path.startsWith(`${id}/`))
		for (const path of held) paths.delete(path)
		tickets += 1
		const ticket = `t${tickets}`
		trash.set(ticket, held)
		return { id, ticket }
	}
	const target: HistoryTarget = {
		file_manager: fm,
		async history_write_attr(id, name, value) {
			if (fail_writes) return false
			attrs.set(key(id, name), value)
			writes.push(`${id}.${name}=${value}`)
			return true
		},
		async history_write_content(id, content) {
			texts.set(id, content)
			writes.push(`${id}=${content}`)
			return true
		},
		async upsert_connections(_folder, list) {
			for (const edge of list) edges.set(edge.id, edge)
			return true
		},
		async delete_connections(_folder, ids) {
			for (const id of ids) edges.delete(id)
			return true
		},
		upsert_strokes: async () => true,
		delete_strokes: async () => true,
		reorder_children: async () => true,
		history_remove_created: async () => 'removed',
		history_create_again: async step => ({ id: step.id }),
		async history_move_entry(from, to) {
			const landed = land_at ?? to
			land_at = null
			paths.delete(from)
			paths.add(landed)
			for (const [k, value] of [...attrs]) {
				if (!k.startsWith(`${from}\0`)) continue
				attrs.delete(k)
				attrs.set(`${landed}${k.slice(from.length)}`, value)
			}
			return landed
		},
		async history_restore_removed(step) {
			restores.push(step.id)
			const held = trash.get(step.receipt.ticket)
			if (!held) return { message: `gone ${step.id}` }
			if (paths.has(step.id)) return 'taken'
			const landed = land_at ?? step.id
			land_at = null
			trash.delete(step.receipt.ticket)
			for (const path of held) paths.add(landed + path.slice(step.id.length))
			for (const [k, value] of [...attrs]) {
				if (!k.startsWith(`${step.id}\0`)) continue
				attrs.delete(k)
				attrs.set(`${landed}${k.slice(step.id.length)}`, value)
			}
			return { id: landed }
		},
		history_remove_again: async id => ({ receipt: to_trash(id), edges: [] }),
	}
	return {
		target,
		attrs,
		texts,
		edges,
		writes,
		set: (id: string, name: string, value: string | null) => attrs.set(key(id, name), value),
		get: (id: string, name: string) => attrs.get(key(id, name)) ?? null,
		fail(value: boolean) {
			fail_writes = value
		},
		paths,
		land(path: string) {
			land_at = path
		},
		trash,
		restores,
		/** Removes what is at `id` and below to the trash, as a delete does: its receipt */
		to_trash,
	}
}

const meta = (label = 'перемещение', extra: Partial<TransactMeta> = {}): TransactMeta => ({
	label,
	folder: { drive_id: 'local', root_id: '/ws', folder_id: '/ws' },
	folder_name: 'ws',
	...extra,
})

const pos = (id: string, before: string | null, after: string | null): HistoryStep =>
	({ kind: 'attr', id, name: 'position', before, after, look: false })

function setup(options: { now?: () => number } = {}) {
	const t = make_target()
	const events: HistoryEvent[] = []
	const h = create_history({ borrow: async () => ({ store: t.target, release: vi.fn() }), now: options.now })
	h.on(event => events.push(event))
	/** An action that writes `after` itself and records the step, as a store method does */
	const act = (steps: HistoryStep[], extra?: Partial<TransactMeta>) =>
		h.transact(meta('перемещение', extra), async (tx) => {
			for (const step of steps) {
				if (step.kind === 'attr') t.set(step.id, step.name, step.after)
				tx?.record(step)
			}
		})
	return { ...t, h, events, act }
}

describe('history', () => {
	test('undo writes back what was, redo what the action made', async () => {
		const s = setup()
		s.set('/ws/a', 'position', '{"x":1}')
		await s.act([pos('/ws/a', '{"x":1}', '{"x":2}')])
		expect(s.h.can_undo).toBe(true)

		await s.h.undo()
		expect(s.get('/ws/a', 'position')).toBe('{"x":1}')
		expect(s.h.can_redo).toBe(true)

		await s.h.redo()
		expect(s.get('/ws/a', 'position')).toBe('{"x":2}')
		expect(s.h.can_redo).toBe(false)
	})

	test('a button sees at once whether there is anything to undo or redo', async () => {
		const s = setup()
		const seen = computed(() => [s.h.can_undo, s.h.can_redo])
		expect(seen.value).toEqual([false, false])

		await s.act([pos('/ws/a', null, '{"x":2}')])
		expect(seen.value).toEqual([true, false])

		await s.h.undo()
		expect(seen.value).toEqual([false, true])

		await s.h.redo()
		expect(seen.value).toEqual([true, false])

		// what cannot be undone empties both without an event
		s.h.barrier('удаление «b»')
		expect(seen.value).toEqual([false, false])
	})

	test('a new action drops what could be redone', async () => {
		const s = setup()
		await s.act([pos('/ws/a', null, '{"x":2}')])
		await s.h.undo()
		await s.act([pos('/ws/b', null, '{"x":5}')])
		expect(s.h.can_redo).toBe(false)
	})

	test('keeps at most 100 records', async () => {
		const s = setup()
		for (let i = 0; i < 105; i++) await s.act([pos(`/ws/${i}`, null, `${i}`)])
		expect(s.h.snapshot().undo).toHaveLength(100)
	})

	test('an action that changed nothing is not kept', async () => {
		const s = setup()
		await s.h.transact(meta(), async (tx) => {
			tx?.record(pos('/ws/a', '{"x":1}', '{"x":2}'))
			tx?.record(pos('/ws/a', '{"x":2}', '{"x":1}'))
		})
		expect(s.h.can_undo).toBe(false)
	})

	test('two writes of one attribute in one action are one step: first before, last after', async () => {
		const s = setup()
		await s.h.transact(meta(), async (tx) => {
			tx?.record(pos('/ws/a', '1', '2'))
			tx?.record(pos('/ws/a', '2', '3'))
		})
		const [record] = s.h.snapshot().undo
		expect(record!.steps).toEqual([pos('/ws/a', '1', '3')])
	})

	test('something changed since is left as it is; the rest of the action is undone', async () => {
		const s = setup()
		await s.act([pos('/ws/a', '1', '2'), pos('/ws/b', '5', '6')])
		// someone else moves b afterwards
		s.set('/ws/b', 'position', '9')

		await s.h.undo()
		expect(s.get('/ws/a', 'position')).toBe('1')
		expect(s.get('/ws/b', 'position')).toBe('9')
		const undone = s.events.find(event => event.type === 'undone')
		expect(undone).toMatchObject({ applied: 1, skipped: 1, failed: 0 })
	})

	test('steps about the same thing are left alone together', async () => {
		const s = setup()
		s.texts.set('/ws/line.svg', 'B')
		await s.h.transact(meta(), async (tx) => {
			tx?.record({ kind: 'content', id: '/ws/line.svg', format: 'svg', before: 'A', after: 'B' })
			s.set('/ws/line.svg', 'position', '2')
			tx?.record(pos('/ws/line.svg', '1', '2'))
		})
		// someone recolored the line: its drawing changed, so its place stays too
		s.texts.set('/ws/line.svg', 'C')
		await s.h.undo()
		expect(s.get('/ws/line.svg', 'position')).toBe('2')
		expect(s.texts.get('/ws/line.svg')).toBe('C')
	})

	test('redo checks that things are as the undo left them', async () => {
		const s = setup()
		await s.act([pos('/ws/a', '1', '2')])
		await s.h.undo()
		s.set('/ws/a', 'position', '7')
		await s.h.redo()
		expect(s.get('/ws/a', 'position')).toBe('7')
		expect(s.events.find(event => event.type === 'redone')).toMatchObject({ applied: 0, skipped: 1 })
	})

	test('arrow nudges that follow each other merge; a pause starts a new record', async () => {
		let clock = 0
		const s = setup({ now: () => clock })
		const nudge = (from: string, to: string) => s.act([pos('/ws/a', from, to)], { merge_key: 'nudge:/ws/a' })
		await nudge('0', '1')
		clock = 300
		await nudge('1', '2')
		clock = 600
		await nudge('2', '3')
		expect(s.h.snapshot().undo).toHaveLength(1)
		clock = 3000
		await nudge('3', '4')
		expect(s.h.snapshot().undo).toHaveLength(2)

		await s.h.undo()
		await s.h.undo()
		expect(s.get('/ws/a', 'position')).toBe('0')
	})

	test('actions are kept in the order they started, whichever ends first', async () => {
		const s = setup()
		let finish_first!: () => void
		const first = s.h.transact(meta('первое'), async (tx) => {
			await new Promise<void>(resolve => { finish_first = resolve })
			s.set('/ws/a', 'position', '1')
			tx?.record(pos('/ws/a', '0', '1'))
		})
		const second = s.h.transact(meta('второе'), async (tx) => {
			s.set('/ws/a', 'position', '2')
			tx?.record(pos('/ws/a', '1', '2'))
		})
		await second
		expect(s.h.can_undo).toBe(false)
		finish_first()
		await first
		expect(s.h.snapshot().undo.map(record => record.label)).toEqual(['первое', 'второе'])
	})

	test('presses during an undo wait for it: each undoes one record', async () => {
		const s = setup()
		await s.act([pos('/ws/a', '0', '1')])
		await s.act([pos('/ws/b', '0', '1')])
		await Promise.all([s.h.undo(), s.h.undo()])
		expect(s.get('/ws/a', 'position')).toBe('0')
		expect(s.get('/ws/b', 'position')).toBe('0')
	})

	test('undo waits for the action still being written', async () => {
		const s = setup()
		let finish!: () => void
		const action = s.h.transact(meta(), async (tx) => {
			await new Promise<void>(resolve => { finish = resolve })
			s.set('/ws/a', 'position', '1')
			tx?.record(pos('/ws/a', '0', '1'))
		})
		const undo = s.h.undo()
		finish()
		await action
		await undo
		expect(s.get('/ws/a', 'position')).toBe('0')
	})

	test('a barrier stops undo with a hint and drops the action it interrupts', async () => {
		const s = setup()
		await s.act([pos('/ws/a', '0', '1')])
		await s.h.transact(meta(), async (tx) => {
			tx?.record(pos('/ws/b', '0', '1'))
			s.h.barrier('удаление «b»')
		})
		await s.h.undo()
		expect(s.get('/ws/a', 'position')).toBe('1')
		expect(s.events).toContainEqual({ type: 'blocked', label: 'удаление «b»' })
	})

	test('the app’s own write amends the nearest step about it, not only the last record', async () => {
		const s = setup()
		const ref = { drive_id: 'local', root_id: '/ws' }
		await s.act([{ kind: 'attr', id: '/ws/t', name: 'size', before: 's0', after: 's1', look: false }])
		await s.act([{ kind: 'attr', id: '/ws/t', name: 'text', before: 'x', after: 'y', look: true }])
		// the text grew the block by itself
		s.set('/ws/t', 'size', 's2')
		s.h.amend_attr(ref, '/ws/t', 'size', 's2')

		await s.h.undo()
		await s.h.undo()
		expect(s.get('/ws/t', 'size')).toBe('s0')
		expect(s.events.filter(event => event.type === 'undone' && event.skipped > 0)).toHaveLength(0)
	})

	test('an amend waiting for redo becomes its "before"', async () => {
		const s = setup()
		const ref = { drive_id: 'local', root_id: '/ws' }
		await s.act([{ kind: 'attr', id: '/ws/t', name: 'size', before: 's0', after: 's1', look: false }])
		await s.h.undo()
		s.set('/ws/t', 'size', 's0b')
		s.h.amend_attr(ref, '/ws/t', 'size', 's0b')
		await s.h.redo()
		expect(s.get('/ws/t', 'size')).toBe('s1')
	})

	test('a failed write is reported and not kept for redo', async () => {
		const s = setup()
		await s.act([pos('/ws/a', '0', '1')])
		s.fail(true)
		await s.h.undo()
		expect(s.events.find(event => event.type === 'undone')).toMatchObject({ applied: 0, failed: 1 })
		expect(s.h.can_redo).toBe(false)
	})

	test('an edge created by the action is deleted by undo and comes back on redo', async () => {
		const s = setup()
		const edge: Connection = { id: 'e1', from: '/ws/a', to: '/ws/b', is_animated: false }
		await s.h.transact(meta('стрелка'), async (tx) => {
			s.edges.set(edge.id, edge)
			tx?.record({ kind: 'edges', folder_id: '/ws', ids: ['e1'], before: [], after: [edge] })
		})
		await s.h.undo()
		expect(s.edges.has('e1')).toBe(false)
		await s.h.redo()
		expect(s.edges.get('e1')).toEqual(edge)
	})

	test('an entry that comes back under another name takes the history with it', async () => {
		const s = setup()
		s.paths.add('/ws/b')
		s.set('/ws/b', 'position', '2')
		// first the card moved, then it was renamed a → b
		await s.act([pos('/ws/a', '1', '2')])
		await s.h.transact(meta('переименование'), async (tx) => {
			tx?.record({ kind: 'entry_move', from: '/ws/a', to: '/ws/b', entry_type: 'file' })
		})
		// meanwhile someone made another "a": the name comes back as "a 2"
		s.land('/ws/a 2')
		await s.h.undo()
		expect(s.paths.has('/ws/a 2')).toBe(true)
		// the older move now finds the card under its new name
		await s.h.undo()
		expect(s.get('/ws/a 2', 'position')).toBe('1')
	})

	test('a store outside the Explorer records nothing', async () => {
		const s = setup()
		await s.h.transact(null, async (tx) => {
			expect(tx).toBeUndefined()
		})
		expect(s.h.can_undo).toBe(false)
	})
})

describe('undo of a delete', () => {
	const removal = (id: string, ticket: string, entry_type: 'file' | 'folder' = 'file'): DeleteStep =>
		({ kind: 'entry_delete', id, entry_type, receipt: { id, ticket }, folder_id: '/ws', edges: [] })
	const deleted = (h: ReturnType<typeof setup>['h'], steps: HistoryStep[]) =>
		h.transact(meta('удаление'), async (tx) => {
			for (const step of steps) tx?.record(step)
		})

	test('a deleted entry comes back by its receipt; redo removes it again and keeps a new one', async () => {
		const { h, paths, to_trash } = setup()
		paths.add('/ws/a')
		const receipt = to_trash('/ws/a')
		await deleted(h, [removal('/ws/a', receipt.ticket)])

		await h.undo()
		expect(paths.has('/ws/a')).toBe(true)
		await h.redo()
		expect(paths.has('/ws/a')).toBe(false)
		const step = h.snapshot().undo[0]!.steps[0] as DeleteStep
		expect(step.receipt.ticket).not.toBe(receipt.ticket)
		await h.undo()
		expect(paths.has('/ws/a')).toBe(true)
	})

	test('an entry whose place was taken since is left out', async () => {
		const { h, paths, to_trash, events } = setup()
		paths.add('/ws/a')
		const receipt = to_trash('/ws/a')
		await deleted(h, [removal('/ws/a', receipt.ticket)])
		paths.add('/ws/a')
		await h.undo()
		expect(events.at(-1)).toMatchObject({ type: 'undone', applied: 0, skipped: 1, failed: 0 })
		expect(h.can_redo).toBe(false)
	})

	test('a folder that cannot come back takes nothing back into it, with one message', async () => {
		const { h, paths, to_trash, trash, restores, events } = setup()
		paths.add('/ws/box')
		paths.add('/ws/box/a')
		const a = to_trash('/ws/box/a')
		const box = to_trash('/ws/box')
		await deleted(h, [removal('/ws/box/a', a.ticket), removal('/ws/box', box.ticket, 'folder')])
		// the trash was emptied meanwhile
		trash.delete(box.ticket)
		await h.undo()
		expect(restores).toEqual(['/ws/box'])
		expect(events.at(-1)).toMatchObject({ type: 'undone', applied: 0, failed: 1, messages: ['gone /ws/box'] })
	})

	test('an entry back under another name takes the rest of its record along', async () => {
		const { h, paths, to_trash, set, get, land } = setup()
		paths.add('/ws/a')
		set('/ws/a', 'position', 'B')
		const receipt = to_trash('/ws/a')
		await deleted(h, [pos('/ws/a', 'A', 'B'), removal('/ws/a', receipt.ticket)])
		// a new "a" took the name: the trash gives it back as "a (1)"
		land('/ws/a (1)')
		await h.undo()
		expect(paths.has('/ws/a (1)')).toBe(true)
		expect(get('/ws/a (1)', 'position')).toBe('A')
	})
})

describe('an action that undoes itself', () => {
	test('undo and redo run its own sides; one that fails says why and is dropped', async () => {
		const { h, events } = setup()
		const sides: string[] = []
		h.record_custom(meta('удаление «Plans»'), {
			undo: async () => { sides.push('undo'); return true },
			redo: async () => { sides.push('redo'); return true },
		})
		await h.undo()
		await h.redo()
		expect(sides).toEqual(['undo', 'redo'])
		expect(events.at(-1)).toMatchObject({ type: 'redone', applied: 1, store: null })

		h.record_custom(meta('восстановление'), { undo: async () => ({ message: 'нельзя' }), redo: async () => true })
		await h.undo()
		expect(events.at(-1)).toMatchObject({ type: 'undone', applied: 0, failed: 1, messages: ['нельзя'] })
		expect(h.can_redo).toBe(false)
		expect(h.can_undo).toBe(true)
	})
})

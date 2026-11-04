import { describe, expect, test, vi } from 'vitest'
import { apply_pending_entry_xattrs, has_unsaved_writes, persist_xattr_now, type WriteNowOptions } from './xattrs'

/** A file manager whose writes wait until the test answers them, in order */
function gated_fm() {
	const calls: { op: 'set' | 'remove'; value: string | null; answer(error?: Error): void }[] = []
	const write = (op: 'set' | 'remove', value: string | null) => new Promise<void>((resolve, reject) => {
		calls.push({ op, value, answer: error => (error ? reject(error) : resolve()) })
	})
	return {
		calls,
		fm: {
			set_xattr: vi.fn((_id: string, _name: string, value: string) => write('set', value)),
			remove_xattr: vi.fn(() => write('remove', null)),
		},
	}
}

function options(over: Partial<WriteNowOptions> = {}) {
	const shown: (string | null)[] = []
	const errors: unknown[] = []
	const value: WriteNowOptions = {
		previous: 'board',
		show: v => { shown.push(v) },
		reread: async () => 'board',
		on_error: error => { errors.push(error) },
		...over,
	}
	return { value, shown, errors }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('persist_xattr_now: a look change shows at once and is written in the background', () => {
	test('on screen before the write; the write settles the promise', async () => {
		const { fm, calls } = gated_fm()
		const o = options()
		const settled = persist_xattr_now(fm, '/', '/', 'view', 'grid', o.value)
		expect(o.shown).toEqual(['grid'])
		expect(has_unsaved_writes()).toBe(true)
		await tick()
		expect(calls.map(call => call.value)).toEqual(['grid'])
		calls[0]!.answer()
		await settled
		expect(has_unsaved_writes()).toBe(false)
		expect(o.errors).toEqual([])
	})

	test('two quick changes: one write at a time, the newest goes last', async () => {
		const { fm, calls } = gated_fm()
		const first = options()
		const second = options()
		const settled = persist_xattr_now(fm, '/', '/', 'view', 'grid', first.value)
		await tick()
		void persist_xattr_now(fm, '/', '/', 'view', 'list', second.value)
		expect(second.shown).toEqual(['list'])
		expect(calls).toHaveLength(1)
		calls[0]!.answer()
		await tick()
		expect(calls.map(call => call.value)).toEqual(['grid', 'list'])
		calls[1]!.answer()
		await settled
	})

	test('a failed write with nothing newer shows what the backend has, and reports', async () => {
		const { fm, calls } = gated_fm()
		const o = options({ reread: async () => 'canvas' })
		const settled = persist_xattr_now(fm, '/', '/', 'view', 'grid', o.value)
		await tick()
		calls[0]!.answer(new Error('offline'))
		await settled
		expect(o.shown).toEqual(['grid', 'canvas'])
		expect(o.errors).toHaveLength(1)
	})

	test('when even the re-read fails, the last saved value comes back', async () => {
		const { fm, calls } = gated_fm()
		const o = options({ previous: 'board', reread: async () => { throw new Error('offline') } })
		const settled = persist_xattr_now(fm, '/', '/', 'view', 'grid', o.value)
		await tick()
		calls[0]!.answer(new Error('offline'))
		await settled
		expect(o.shown).toEqual(['grid', 'board'])
	})

	test('a failed write that a newer change replaced: the newer one is written, nothing rolls back', async () => {
		const { fm, calls } = gated_fm()
		const first = options()
		const second = options()
		const settled = persist_xattr_now(fm, '/', '/', 'view', 'grid', first.value)
		await tick()
		void persist_xattr_now(fm, '/', '/', 'view', 'list', second.value)
		calls[0]!.answer(new Error('offline'))
		await tick()
		expect(calls.map(call => call.value)).toEqual(['grid', 'list'])
		calls[1]!.answer()
		await settled
		expect(first.errors).toEqual([])
		expect(second.errors).toEqual([])
		expect(second.shown).toEqual(['list'])
	})

	test('a picture: written only after its upload; a failed upload puts the last saved one back unwritten', async () => {
		const { fm, calls } = gated_fm()
		let uploaded: (ok: boolean) => void = () => {}
		const after = new Promise<boolean>(resolve => { uploaded = resolve })
		const o = options({ previous: 'pile:cover-aaaaaaaa.webp', after })
		const settled = persist_xattr_now(fm, '/', '/', 'cover', 'pile:cover-bbbbbbbb.webp', o.value)
		await tick()
		expect(calls).toHaveLength(0)
		expect(has_unsaved_writes()).toBe(true)
		uploaded(false)
		await settled
		expect(calls).toHaveLength(0)
		expect(o.shown).toEqual(['pile:cover-bbbbbbbb.webp', 'pile:cover-aaaaaaaa.webp'])
	})

	test('a new picture while the first uploads: only the newest is written', async () => {
		const { fm, calls } = gated_fm()
		let first_up: (ok: boolean) => void = () => {}
		let second_up: (ok: boolean) => void = () => {}
		const first = options({ after: new Promise<boolean>(resolve => { first_up = resolve }) })
		const second = options({ after: new Promise<boolean>(resolve => { second_up = resolve }) })
		const settled = persist_xattr_now(fm, '/', '/', 'cover', 'pile:cover-11111111.webp', first.value)
		await tick()
		void persist_xattr_now(fm, '/', '/', 'cover', 'pile:cover-22222222.webp', second.value)
		first_up(true)
		await tick()
		expect(calls).toHaveLength(0)
		second_up(true)
		await tick()
		expect(calls.map(call => call.value)).toEqual(['pile:cover-22222222.webp'])
		calls[0]!.answer()
		await settled
	})

	test('two stores (two file managers) with the same path do not share a queue', async () => {
		const a = gated_fm()
		const b = gated_fm()
		void persist_xattr_now(a.fm, '/', '/', 'view', 'grid', options().value)
		void persist_xattr_now(b.fm, '/', '/', 'view', 'list', options().value)
		await tick()
		expect(a.calls.map(call => call.value)).toEqual(['grid'])
		expect(b.calls.map(call => call.value)).toEqual(['list'])
		a.calls[0]!.answer()
		b.calls[0]!.answer()
	})

	test('a pending look on one root does not land on the same path of another workspace while it uploads', async () => {
		const { fm, calls } = gated_fm()
		let uploaded: (ok: boolean) => void = () => {}
		const settled = persist_xattr_now(fm, '/x', '/x', 'cover', 'pile:cover-cccccccc.webp', options({
			scope: 'ws-a',
			after: new Promise<boolean>(resolve => { uploaded = resolve }),
		}).value)
		const snapshot = (cover: string) => ({ id: '/x', name: '', type: 'folder' as const, xattrs: [{ name: 'cover', value: cover }], children: [] })
		const other = snapshot('#378ADD')
		apply_pending_entry_xattrs(other, 'ws-b')
		expect(other.xattrs).toEqual([{ name: 'cover', value: '#378ADD' }])
		const own = snapshot('#378ADD')
		apply_pending_entry_xattrs(own, 'ws-a')
		expect(own.xattrs).toEqual([{ name: 'cover', value: 'pile:cover-cccccccc.webp' }])
		uploaded(true)
		await tick()
		calls[0]!.answer()
		await settled
	})
})

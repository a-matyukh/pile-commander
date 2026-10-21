import { describe, expect, test, vi } from 'vitest'
import { new_row, planned_names, rename_entry, run_pool, type BulkRow } from './bulkRename'

function ready(id: string, name: string, suggestion: string, checked = true): BulkRow {
	return { ...new_row({ id, name, type: 'file' }), status: 'ready', suggestion, checked }
}

describe('planned_names', () => {
	test('numbers a name another file in the folder holds, the app\'s usual way', () => {
		const rows = [ready('/a', 'IMG_1.jpg', 'Beach.jpg')]
		expect(planned_names(rows, ['IMG_1.jpg', 'Beach.jpg']).get('/a')).toBe('Beach (1).jpg')
	})

	test('numbers two rows that got the same suggestion', () => {
		const rows = [ready('/a', 'IMG_1.jpg', 'Beach.jpg'), ready('/b', 'IMG_2.jpg', 'Beach.jpg')]
		const planned = planned_names(rows, ['IMG_1.jpg', 'IMG_2.jpg'])
		expect(planned.get('/a')).toBe('Beach.jpg')
		expect(planned.get('/b')).toBe('Beach (1).jpg')
	})

	test('a row may not take a name another row still holds', () => {
		const rows = [ready('/a', 'a.jpg', 'b.jpg'), ready('/b', 'b.jpg', 'c.jpg')]
		expect(planned_names(rows, ['a.jpg', 'b.jpg']).get('/a')).toBe('b (1).jpg')
	})

	test('a suggestion equal to the current name stays that name', () => {
		const rows = [ready('/a', 'Beach.jpg', 'Beach.jpg')]
		expect(planned_names(rows, ['Beach.jpg']).get('/a')).toBe('Beach.jpg')
	})

	test('unchecking a row frees its suggestion for the next one', () => {
		const rows = [ready('/a', 'IMG_1.jpg', 'Beach.jpg', false), ready('/b', 'IMG_2.jpg', 'Beach.jpg')]
		const planned = planned_names(rows, ['IMG_1.jpg', 'IMG_2.jpg'])
		expect(planned.has('/a')).toBe(false)
		expect(planned.get('/b')).toBe('Beach.jpg')
	})
})

describe('run_pool', () => {
	test('runs at most `concurrency` at a time', async () => {
		let running = 0
		let peak = 0
		await run_pool([1, 2, 3, 4, 5], 2, async () => {
			running++
			peak = Math.max(peak, running)
			await new Promise(resolve => setTimeout(resolve, 1))
			running--
		})
		expect(peak).toBe(2)
	})

	test('starts nothing after the signal aborts', async () => {
		const controller = new AbortController()
		const seen: number[] = []
		await run_pool([1, 2, 3], 1, async (item) => {
			seen.push(item)
			if (item === 1) controller.abort()
		}, controller.signal)
		expect(seen).toEqual([1])
	})
})

describe('rename_entry', () => {
	function store(behaviour: (self: { last_error: string | null; names: string[] }, name: string) => void) {
		const self = {
			last_error: 'an earlier error' as string | null,
			names: ['a.jpg'],
			rename: vi.fn(async (_: string, name: string) => behaviour(self, name)),
			resolve_folder_data: () => ({ id: '/f', name: 'f', type: 'folder' as const, xattrs: [], children: self.names.map(n => ({ id: `/f/${n}`, name: n, type: 'file' as const, xattrs: [] })) }),
		}
		return self
	}

	test('success is the new name in the folder, and the earlier error is kept', async () => {
		const ws = store((self, name) => {
			self.names = [name]
		})
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toBeNull()
		expect(ws.last_error).toBe('an earlier error')
	})

	test('a store failure is returned, not left as a banner', async () => {
		const ws = store((self) => {
			self.last_error = 'EACCES: permission denied'
		})
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toBe('EACCES: permission denied')
		expect(ws.last_error).toBe('an earlier error')
	})

	test('a silent no-op, a file gone meanwhile, is a failure', async () => {
		const ws = store(() => {})
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toContain('moved or removed')
	})
})

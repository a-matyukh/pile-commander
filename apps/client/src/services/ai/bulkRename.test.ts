import { describe, expect, test, vi } from 'vitest'
import { is_batch_stopping_error, NAME_TAKEN_MEANWHILE, new_row, planned_names, rename_entry, run_pool, type BulkRow } from './bulkRename'
import { AiError } from './types'

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

describe('planned_names ignores case, as the macOS file system does', () => {
	test('Beach.jpg is taken by beach.jpg', () => {
		const rows = [ready('/f/IMG_1.jpg', 'IMG_1.jpg', 'Beach.jpg')]
		expect(planned_names(rows, ['IMG_1.jpg', 'beach.jpg']).get('/f/IMG_1.jpg')).toBe('Beach (1).jpg')
	})

	test('the numbered name is checked ignoring case too', () => {
		const rows = [ready('/f/IMG_1.jpg', 'IMG_1.jpg', 'Beach.jpg')]
		expect(planned_names(rows, ['IMG_1.jpg', 'beach.jpg', 'BEACH (1).jpg']).get('/f/IMG_1.jpg')).toBe('Beach (2).jpg')
	})

	test('two rows differing only in case get different names', () => {
		const rows = [ready('/f/a.jpg', 'a.jpg', 'Beach.jpg'), ready('/f/b.jpg', 'b.jpg', 'beach.jpg')]
		const planned = planned_names(rows, ['a.jpg', 'b.jpg'])
		expect(planned.get('/f/a.jpg')).toBe('Beach.jpg')
		expect(planned.get('/f/b.jpg')).toBe('beach (1).jpg')
	})

	test('a name on disk written decomposed (NFD) is taken for the model\'s NFC answer', () => {
		const on_disk = 'Пляж у моря и мой зонт.jpg'.normalize('NFD')
		const rows = [ready('/f/IMG_1.jpg', 'IMG_1.jpg', 'Пляж у моря и мой зонт.jpg'.normalize('NFC'))]
		expect(planned_names(rows, ['IMG_1.jpg', on_disk]).get('/f/IMG_1.jpg'))
			.toBe('Пляж у моря и мой зонт (1).jpg'.normalize('NFC'))
	})

	test('a change of case alone keeps the name, not a number', () => {
		const rows = [ready('/f/orange bag.jpg', 'orange bag.jpg', 'Orange bag.jpg')]
		expect(planned_names(rows, ['orange bag.jpg']).get('/f/orange bag.jpg')).toBe('Orange bag.jpg')
	})
})

describe('rename_entry', () => {
	function store(names: string[], rename: (self: { names: string[] }, id: string, name: string) => void) {
		const self = {
			names,
			rename: vi.fn(async (id: string, name: string, _options?: { report?: boolean }) => rename(self, id, name)),
			resolve_folder_data: () => ({ id: '/f', name: 'f', type: 'folder' as const, xattrs: [], children: self.names.map(n => ({ id: `/f/${n}`, name: n, type: 'file' as const, xattrs: [] })) }),
		}
		return self
	}
	const renames = (self: { names: string[] }, id: string, name: string) => {
		self.names = self.names.map(n => (`/f/${n}` === id ? name : n))
	}

	test('success is the new name in the folder; the store is asked not to raise its toast', async () => {
		const ws = store(['a.jpg'], renames)
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toBeNull()
		expect(ws.rename).toHaveBeenCalledWith('/f/a.jpg', 'Beach.jpg', { report: false })
	})

	test('a store failure is returned', async () => {
		const ws = store(['a.jpg'], () => {
			throw new Error('EACCES: permission denied')
		})
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toBe('EACCES: permission denied')
	})

	test('a name another file took meanwhile is never overwritten, whatever its case', async () => {
		const ws = store(['a.jpg', 'beach.jpg'], renames)
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toBe(NAME_TAKEN_MEANWHILE)
		expect(ws.rename).not.toHaveBeenCalled()
		expect(ws.names).toEqual(['a.jpg', 'beach.jpg'])
	})

	test('a name another file holds decomposed (NFD) is never overwritten', async () => {
		const ws = store(['a.jpg', 'мой зонт.jpg'.normalize('NFD')], renames)
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Мой зонт.jpg'.normalize('NFC'))).toBe(NAME_TAKEN_MEANWHILE)
		expect(ws.rename).not.toHaveBeenCalled()
	})

	test('the entry\'s own name in another case is not a clash', async () => {
		const ws = store(['orange bag.jpg'], renames)
		expect(await rename_entry(ws, '/f', '/f/orange bag.jpg', 'Orange bag.jpg')).toBeNull()
	})

	test('a silent no-op, a file gone meanwhile, is a failure', async () => {
		const ws = store(['a.jpg'], () => {})
		expect(await rename_entry(ws, '/f', '/f/a.jpg', 'Beach.jpg')).toContain('moved or removed')
	})
})

describe('is_batch_stopping_error', () => {
	test('stops on what fails every row, goes on for one bad answer', () => {
		const error = (kind: AiError['kind'], status: number | null = null) => new AiError({ kind, status, message: '' })
		expect(is_batch_stopping_error(error('timeout'))).toBe(true)
		expect(is_batch_stopping_error(error('not_found', 404))).toBe(true)
		expect(is_batch_stopping_error(error('connect'))).toBe(true)
		expect(is_batch_stopping_error(error('unauthorized', 401))).toBe(true)
		expect(is_batch_stopping_error(error('bad_request', 400))).toBe(false)
		expect(is_batch_stopping_error(error('provider'))).toBe(false)
		expect(is_batch_stopping_error(error('http', 500))).toBe(false)
	})
})

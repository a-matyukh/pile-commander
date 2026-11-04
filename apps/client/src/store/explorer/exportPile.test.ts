import { afterEach, describe, expect, test, vi } from 'vitest'
import { explorer_language } from './language'
import {
	begin_pile_export,
	dismiss_pile_export,
	fail_pile_export,
	finish_pile_export,
	pile_export,
	pile_export_copy,
	pile_export_downloading,
	pile_export_packing,
	run_pile_export,
} from './exportPile'

afterEach(() => {
	dismiss_pile_export()
	vi.useRealTimers()
	explorer_language.value = 'system'
})

describe('pile export', () => {
	test('opens on preparing and walks downloading, packing, done', () => {
		expect(pile_export.current).toBeNull()
		begin_pile_export('Harbor')
		expect(pile_export.current).not.toBeNull()
		expect(pile_export.current?.phase).toBe('preparing')

		pile_export_downloading(1, 4)
		expect(pile_export.current?.phase).toBe('downloading')
		expect(pile_export.current?.done).toBe(1)
		expect(pile_export.current?.total).toBe(4)

		pile_export_packing()
		expect(pile_export.current?.phase).toBe('packing')

		finish_pile_export('Harbor.pile', null)
		expect(pile_export.current?.phase).toBe('done')
		expect(pile_export.current?.file_name).toBe('Harbor.pile')
		expect(pile_export.current?.path).toBeNull()
	})

	test('an error stays on the panel and is not rethrown', async () => {
		begin_pile_export('Harbor')
		pile_export_downloading(0, 2)
		fail_pile_export('read failed')
		expect(pile_export.current?.phase).toBe('error')
		expect(pile_export.current?.message).toBe('read failed')

		await expect(run_pile_export('Harbor', async () => {
			throw new Error('read failed')
		})).resolves.toBeUndefined()
		expect(pile_export.current?.phase).toBe('error')
		expect(pile_export.current?.message).toBe('read failed')
	})

	test('the panel is already open before the work awaits', async () => {
		let phase_at_start: string | null = null
		const pending = run_pile_export('Harbor', async () => {
			phase_at_start = pile_export.current?.phase ?? null
			return { file_name: 'Harbor.pile', path: null }
		})
		expect(pile_export.current).not.toBeNull()
		expect(pile_export.current?.phase).toBe('preparing')
		await pending
		expect(phase_at_start).toBe('preparing')
		expect(pile_export.current?.phase).toBe('done')
	})

	test('a service file name never reaches the panel text', () => {
		explorer_language.value = 'ru'
		begin_pile_export('Harbor')
		const file_name = 'background-27cdd952.webp'
		pile_export_downloading(2, 5)
		const text = pile_export_copy(pile_export.current!)
		expect(text).toContain('Экспорт')
		expect(text).toContain('Скачиваю файлы: 2 из 5')
		expect(text).not.toContain(file_name)
		expect(text).not.toMatch(/\.webp/)
		expect(JSON.stringify(pile_export.current)).not.toContain(file_name)
	})

	test('done closes itself, an error stays until it is dismissed', () => {
		vi.useFakeTimers()
		explorer_language.value = 'ru'
		begin_pile_export('Harbor')
		finish_pile_export('Harbor.pile', '/tmp/Harbor.pile')
		expect(pile_export_copy(pile_export.current!)).toContain('Показать в Finder')
		vi.advanceTimersByTime(6000)
		expect(pile_export.current).toBeNull()

		begin_pile_export('Harbor')
		fail_pile_export('read failed')
		vi.advanceTimersByTime(6000)
		expect(pile_export.current?.phase).toBe('error')
	})
})

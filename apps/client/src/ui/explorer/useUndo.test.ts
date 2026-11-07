import { beforeEach, describe, expect, test, vi } from 'vitest'
import type { WorkspaceStore } from '@/domain/Store'
import type { HistoryEvent } from '@/store/history'

const navigation = vi.hoisted(() => ({
	location: null as unknown,
	open_folder: vi.fn(async () => {}),
}))
vi.mock('@/store/explorer/navigation', () => ({ explorer_navigation: navigation }))

const { show_history_event, undo_key } = await import('./useUndo')
const { explorer_language } = await import('@/store/explorer/language')
// The toasts are checked in Russian, the app's first language
explorer_language.value = 'ru'

const key = (code: string, mods: Partial<Record<'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey', boolean>> = {}) => ({
	code,
	metaKey: false,
	ctrlKey: false,
	altKey: false,
	shiftKey: false,
	...mods,
})

describe('undo_key', () => {
	test('⌘Z and Ctrl+Z undo; with Shift they redo; Ctrl+Y redoes', () => {
		expect(undo_key(key('KeyZ', { metaKey: true }))).toBe('undo')
		expect(undo_key(key('KeyZ', { ctrlKey: true }))).toBe('undo')
		expect(undo_key(key('KeyZ', { metaKey: true, shiftKey: true }))).toBe('redo')
		expect(undo_key(key('KeyY', { ctrlKey: true }))).toBe('redo')
	})

	test('goes by the key’s place, so a Russian layout ("я") works the same', () => {
		// event.code stays KeyZ whatever letter the layout puts there
		expect(undo_key({ ...key('KeyZ', { metaKey: true }), key: 'я' } as never)).toBe('undo')
	})

	test('leaves other keys alone', () => {
		expect(undo_key(key('KeyZ'))).toBeNull()
		expect(undo_key(key('KeyZ', { metaKey: true, altKey: true }))).toBeNull()
		expect(undo_key(key('KeyX', { metaKey: true }))).toBeNull()
	})
})

describe('show_history_event', () => {
	const toast = { add: vi.fn() }
	const store = {
		opened_folder_id: '/ws',
		opened_folder: { id: '/ws', name: 'ws', type: 'folder', xattrs: [], children: [{ id: '/ws/a.md', name: 'a.md', type: 'file', xattrs: [] }] },
		set_selection: vi.fn(),
	} as unknown as WorkspaceStore
	const record = {
		id: 1,
		label: 'перемещение «a.md»',
		folder: { drive_id: 'local', root_id: '/ws', folder_id: '/ws' },
		folder_name: 'ws',
		steps: [],
		updated_at: 0,
	}
	type Applied = Extract<HistoryEvent<WorkspaceStore>, { applied: number }>
	const undone = (extra: Partial<Applied> = {}) =>
		({ type: 'undone', record, store, applied: 1, skipped: 0, failed: 0, affected: ['/ws/a.md'], ...extra }) as HistoryEvent<WorkspaceStore>

	beforeEach(() => {
		toast.add.mockClear()
		vi.mocked(store.set_selection).mockClear()
	})

	test('on screen: no toast, what came back is selected', () => {
		navigation.location = { kind: 'folder', ref: record.folder }
		show_history_event(undone(), toast)
		expect(toast.add).not.toHaveBeenCalled()
		expect(store.set_selection).toHaveBeenCalledWith(['/ws/a.md'])
	})

	test('in another folder: a toast names it and offers to show it', () => {
		navigation.location = { kind: 'folder', ref: { drive_id: 'local', root_id: '/ws', folder_id: '/elsewhere' } }
		show_history_event(undone(), toast)
		const [shown] = toast.add.mock.calls[0]!
		expect(shown.title).toBe('Отменено в «ws»: перемещение «a.md»')
		shown.actions[0].onClick()
		expect(navigation.open_folder).toHaveBeenCalledWith(record.folder)
	})

	test('what someone changed since is counted in the toast', () => {
		navigation.location = { kind: 'folder', ref: record.folder }
		show_history_event(undone({ applied: 0, skipped: 3 }), toast)
		expect(toast.add.mock.calls[0]![0].title).toBe('3 объекта изменили после этого — их не трогали')
	})

	test('an action that cannot be undone yet is named', () => {
		show_history_event({ type: 'blocked', label: 'удаление «a.md»' }, toast)
		expect(toast.add.mock.calls[0]![0].title).toBe('Это пока нельзя отменить: удаление «a.md»')
	})
})

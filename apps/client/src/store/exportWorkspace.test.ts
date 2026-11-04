import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import type { ImportProgress, WorkspaceStore } from '@/domain/Store'
import { dismiss_pile_export, pile_export, pile_export_copy } from './explorer/exportPile'

const desktop = vi.hoisted(() => ({ on: false }))
const save_pile_file = vi.hoisted(() => vi.fn(async (_name: string) => '/tmp/Board.pile'))
const build_cloud_workspace_pile = vi.hoisted(() => vi.fn())
const export_cloud_workspace_to_pile = vi.hoisted(() => vi.fn())
const download_blob = vi.hoisted(() => vi.fn())

vi.mock('@/isDesktop', () => ({
	get is_desktop() {
		return desktop.on
	},
}))

vi.mock('@/services/window/WindowManager', () => ({
	create_window_manager: () => ({
		save_pile_file,
		pick_pile_file: vi.fn(async () => null),
		pick_folder: vi.fn(async () => null),
		close: vi.fn(),
		minimize: vi.fn(),
		hide: vi.fn(),
	}),
}))

vi.mock('@/services/workspace/pack', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@/services/workspace/pack')>()
	return {
		...actual,
		build_cloud_workspace_pile: (...args: unknown[]) => build_cloud_workspace_pile(...args),
		export_cloud_workspace_to_pile: (...args: unknown[]) => export_cloud_workspace_to_pile(...args),
	}
})

vi.mock('@pile-commander/file-manager', async (importOriginal) => ({
	...await importOriginal<typeof import('@pile-commander/file-manager')>(),
	download_blob: (...args: unknown[]) => download_blob(...args),
}))

const { default: store } = await import('./index')

const progress: ImportProgress = {
	file_name: 'note.md',
	file_index: 1,
	total_files: 1,
	loaded_bytes: 1,
	total_bytes: 1,
}

function workspace(type: 'cloud' | 'local'): WorkspaceStore {
	return {
		type,
		name: 'My: board',
		id: type === 'cloud' ? '/' : '/tmp/board',
		file_manager: {},
		import_progress: null,
	} as WorkspaceStore
}

describe('export_current_workspace', () => {
	let console_error: ReturnType<typeof vi.spyOn>

	beforeEach(() => {
		desktop.on = false
		save_pile_file.mockClear()
		save_pile_file.mockResolvedValue('/tmp/Board.pile')
		build_cloud_workspace_pile.mockReset()
		export_cloud_workspace_to_pile.mockReset()
		download_blob.mockReset()
		store.last_error = null
		console_error = vi.spyOn(console, 'error').mockImplementation(() => {})
	})

	afterEach(() => {
		console_error.mockRestore()
		dismiss_pile_export()
	})

	test('on the web a cloud workspace downloads, and the save dialog stays closed', async () => {
		const ws = workspace('cloud')
		const blob = new Blob(['pile'])
		build_cloud_workspace_pile.mockImplementation(async (_fm: unknown, _name: unknown, on_progress?: (progress: ImportProgress) => void, on_packing?: () => void) => {
			expect(pile_export.current?.phase).toBe('preparing')
			on_progress?.(progress)
			expect(pile_export.current?.phase).toBe('downloading')
			expect(pile_export_copy(pile_export.current!)).not.toContain(progress.file_name)
			on_packing?.()
			expect(pile_export.current?.phase).toBe('packing')
			return blob
		})

		await store.export_current_workspace(ws)

		expect(build_cloud_workspace_pile).toHaveBeenCalledTimes(1)
		expect(download_blob).toHaveBeenCalledTimes(1)
		expect(download_blob).toHaveBeenCalledWith(blob, 'My_ board.pile')
		expect(save_pile_file).not.toHaveBeenCalled()
		expect(export_cloud_workspace_to_pile).not.toHaveBeenCalled()
		expect(ws.import_progress).toBeNull()
		expect(pile_export.current?.phase).toBe('done')
		expect(pile_export.current?.file_name).toBe('My_ board.pile')
		expect(pile_export.current?.path).toBeNull()
		expect(store.last_error).toBeNull()
	})

	test('a failed web download still clears the progress', async () => {
		const ws = workspace('cloud')
		build_cloud_workspace_pile.mockImplementation(async (_fm: unknown, _name: unknown, on_progress?: (progress: ImportProgress) => void) => {
			on_progress?.(progress)
			throw new Error('read failed')
		})

		await store.export_current_workspace(ws)

		expect(save_pile_file).not.toHaveBeenCalled()
		expect(download_blob).not.toHaveBeenCalled()
		expect(ws.import_progress).toBeNull()
		expect(pile_export.current?.phase).toBe('error')
		expect(pile_export.current?.message).toBe('read failed')
		expect(store.last_error).toBeNull()
	})

	test('on the web a local workspace is still refused', async () => {
		await store.export_current_workspace(workspace('local'))

		expect(store.last_error).toBe('Open a local workspace in the desktop app to export')
		expect(pile_export.current).toBeNull()
		expect(store.last_error).not.toMatch(/cloud/i)
		expect(save_pile_file).not.toHaveBeenCalled()
		expect(build_cloud_workspace_pile).not.toHaveBeenCalled()
		expect(download_blob).not.toHaveBeenCalled()
		expect(export_cloud_workspace_to_pile).not.toHaveBeenCalled()
	})

	test('on the desktop a cloud workspace still opens the save dialog once', async () => {
		desktop.on = true
		const ws = workspace('cloud')
		save_pile_file.mockImplementation(async () => {
			expect(pile_export.current).toBeNull()
			return '/tmp/Board.pile'
		})
		export_cloud_workspace_to_pile.mockImplementation(async (_fm: unknown, _name: unknown, _path: unknown, on_progress?: (progress: ImportProgress) => void) => {
			expect(pile_export.current?.phase).toBe('preparing')
			on_progress?.(progress)
			expect(pile_export.current?.phase).toBe('downloading')
			expect(ws.import_progress).toBeNull()
			expect(pile_export_copy(pile_export.current!)).not.toContain(progress.file_name)
		})

		await store.export_current_workspace(ws)

		expect(save_pile_file).toHaveBeenCalledTimes(1)
		expect(save_pile_file).toHaveBeenCalledWith('My: board.pile')
		expect(export_cloud_workspace_to_pile).toHaveBeenCalledTimes(1)
		expect(export_cloud_workspace_to_pile.mock.calls[0]?.[1]).toBe('My: board')
		expect(export_cloud_workspace_to_pile.mock.calls[0]?.[2]).toBe('/tmp/Board.pile')
		expect(build_cloud_workspace_pile).not.toHaveBeenCalled()
		expect(download_blob).not.toHaveBeenCalled()
		expect(ws.import_progress).toBeNull()
		expect(pile_export.current?.phase).toBe('done')
		expect(pile_export.current?.path).toBe('/tmp/Board.pile')
		expect(pile_export.current?.file_name).toBe('Board.pile')
		expect(store.last_error).toBeNull()
	})

	test('cancelling the desktop save dialog leaves the panel closed', async () => {
		desktop.on = true
		save_pile_file.mockResolvedValue(null)

		await store.export_current_workspace(workspace('cloud'))

		expect(export_cloud_workspace_to_pile).not.toHaveBeenCalled()
		expect(pile_export.current).toBeNull()
		expect(store.last_error).toBeNull()
	})
})

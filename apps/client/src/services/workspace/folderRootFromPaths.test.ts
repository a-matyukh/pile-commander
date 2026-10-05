import { beforeEach, describe, expect, test, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({
	invoke: (...args: unknown[]) => invoke(...args),
}))

const { applySingleFolderPath, applyOpenedPaths, applyWorkspaceDropPaths } = await import('./folderRootFromPaths')

describe('applySingleFolderPath', () => {
	beforeEach(() => {
		invoke.mockReset()
	})

	test('opens exactly one directory', async () => {
		invoke.mockResolvedValue(undefined)
		const onFolderDrop = vi.fn()
		const onError = vi.fn()

		await applySingleFolderPath(['/home/ws'], onFolderDrop, onError)

		expect(invoke).toHaveBeenCalledWith('ensure_directory', { path: '/home/ws' })
		expect(onFolderDrop).toHaveBeenCalledWith('/home/ws')
		expect(onError).not.toHaveBeenCalled()
	})

	test('rejects multiple paths', async () => {
		const onFolderDrop = vi.fn()
		const onError = vi.fn()

		await applySingleFolderPath(['/a', '/b'], onFolderDrop, onError)

		expect(onFolderDrop).not.toHaveBeenCalled()
		expect(onError).toHaveBeenCalledWith('Drop exactly one folder')
	})
})

describe('applyOpenedPaths', () => {
	beforeEach(() => {
		invoke.mockReset()
	})

	test('opens a single directory', async () => {
		invoke.mockImplementation((cmd: string) => {
			if (cmd === 'path_kind') return 'directory'
			return undefined
		})
		const onFolderDrop = vi.fn()
		const onPileOpen = vi.fn()
		const onError = vi.fn()

		await applyOpenedPaths(['/home/ws'], { onFolderDrop, onPileOpen, onError })

		expect(onFolderDrop).toHaveBeenCalledWith('/home/ws')
		expect(onPileOpen).not.toHaveBeenCalled()
		expect(onError).not.toHaveBeenCalled()
	})

	test('imports a .pile file', async () => {
		invoke.mockResolvedValue('file')
		const onFolderDrop = vi.fn()
		const onPileOpen = vi.fn()
		const onError = vi.fn()

		await applyOpenedPaths(['/tmp/board.pile'], { onFolderDrop, onPileOpen, onError })

		expect(onPileOpen).toHaveBeenCalledWith('/tmp/board.pile')
		expect(onFolderDrop).not.toHaveBeenCalled()
		expect(onError).not.toHaveBeenCalled()
	})

	test('rejects non-pile files', async () => {
		invoke.mockResolvedValue('file')
		const onError = vi.fn()

		await applyOpenedPaths(['/tmp/notes.txt'], {
			onFolderDrop: vi.fn(),
			onPileOpen: vi.fn(),
			onError,
		})

		expect(onError).toHaveBeenCalledWith('Open a folder or a .pile workspace file')
	})

	test('rejects multiple paths', async () => {
		const onError = vi.fn()

		await applyOpenedPaths(['/a', '/b'], {
			onFolderDrop: vi.fn(),
			onPileOpen: vi.fn(),
			onError,
		})

		expect(onError).toHaveBeenCalledWith('Open exactly one folder or .pile file')
	})
})

describe('applyWorkspaceDropPaths', () => {
	beforeEach(() => {
		invoke.mockReset()
	})

	test('opens a single directory', async () => {
		invoke.mockResolvedValue('directory')
		const onFolderDrop = vi.fn()
		const onFilesDrop = vi.fn()
		const onPileOpen = vi.fn()
		const onError = vi.fn()

		await applyWorkspaceDropPaths(['/home/ws'], {
			onFolderDrop,
			onFilesDrop,
			onPileOpen,
			onError,
		})

		expect(invoke).toHaveBeenCalledWith('path_kind', { path: '/home/ws' })
		expect(onFolderDrop).toHaveBeenCalledWith('/home/ws')
		expect(onFilesDrop).not.toHaveBeenCalled()
	})

	test('imports only files', async () => {
		invoke.mockImplementation((_cmd: string, args: { path: string }) => {
			if (args.path.endsWith('.png') || args.path.endsWith('.txt')) return 'file'
			return 'other'
		})
		const onFolderDrop = vi.fn()
		const onFilesDrop = vi.fn()
		const onPileOpen = vi.fn()
		const onError = vi.fn()

		await applyWorkspaceDropPaths(['/tmp/a.png', '/tmp/b.txt'], {
			onFolderDrop,
			onFilesDrop,
			onPileOpen,
			onError,
		})

		expect(onFilesDrop).toHaveBeenCalledWith(['/tmp/a.png', '/tmp/b.txt'])
		expect(onFolderDrop).not.toHaveBeenCalled()
		expect(onPileOpen).not.toHaveBeenCalled()
		expect(onError).not.toHaveBeenCalled()
	})

	test('imports a single .pile file', async () => {
		invoke.mockResolvedValue('file')
		const onPileOpen = vi.fn()
		const onFilesDrop = vi.fn()
		const onError = vi.fn()

		await applyWorkspaceDropPaths(['/tmp/board.pile'], {
			onFolderDrop: vi.fn(),
			onFilesDrop,
			onPileOpen,
			onError,
		})

		expect(onPileOpen).toHaveBeenCalledWith('/tmp/board.pile')
		expect(onFilesDrop).not.toHaveBeenCalled()
		expect(onError).not.toHaveBeenCalled()
	})

	test('rejects .pile mixed with other files', async () => {
		invoke.mockResolvedValue('file')
		const onError = vi.fn()

		await applyWorkspaceDropPaths(['/tmp/board.pile', '/tmp/a.png'], {
			onFolderDrop: vi.fn(),
			onFilesDrop: vi.fn(),
			onPileOpen: vi.fn(),
			onError,
		})

		expect(onError).toHaveBeenCalledWith('Drop exactly one .pile file to import a workspace')
	})

	test('rejects mixed folder and files', async () => {
		invoke.mockImplementation((_cmd: string, args: { path: string }) => {
			return args.path.includes('folder') ? 'directory' : 'file'
		})
		const onFolderDrop = vi.fn()
		const onFilesDrop = vi.fn()
		const onError = vi.fn()

		await applyWorkspaceDropPaths(['/tmp/folder', '/tmp/a.png'], {
			onFolderDrop,
			onFilesDrop,
			onPileOpen: vi.fn(),
			onError,
		})

		expect(onFolderDrop).not.toHaveBeenCalled()
		expect(onFilesDrop).not.toHaveBeenCalled()
		expect(onError).toHaveBeenCalledWith('Drop either one folder, one .pile file, or only files')
	})

	test('rejects multiple directories', async () => {
		invoke.mockResolvedValue('directory')
		const onError = vi.fn()

		await applyWorkspaceDropPaths(['/a', '/b'], {
			onFolderDrop: vi.fn(),
			onFilesDrop: vi.fn(),
			onPileOpen: vi.fn(),
			onError,
		})

		expect(onError).toHaveBeenCalledWith('Drop exactly one folder')
	})
})

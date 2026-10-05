import { invoke } from '@tauri-apps/api/core'

export type PathKind = 'directory' | 'file' | 'other'

export type WorkspaceDropHandlers = {
	onFolderDrop: (path: string) => void | Promise<void>
	onFilesDrop: (paths: string[]) => void | Promise<void>
	onPileOpen: (path: string) => void | Promise<void>
	onError: (message: string) => void
}

export type OpenedPathHandlers = {
	onFolderDrop: (path: string) => void | Promise<void>
	onPileOpen: (path: string) => void | Promise<void>
	onError: (message: string) => void
}

export async function classify_path(path: string): Promise<PathKind> {
	const kind = await invoke<string>('path_kind', { path })
	if (kind === 'directory' || kind === 'file') return kind
	return 'other'
}

function is_pile_file(path: string): boolean {
	return path.toLowerCase().endsWith('.pile')
}

/** Opens exactly one directory as a workspace root (Dock / Open With). */
export async function applySingleFolderPath(
	paths: string[],
	onFolderDrop: (path: string) => void | Promise<void>,
	onError: (message: string) => void,
): Promise<void> {
	if (paths.length !== 1) {
		onError('Drop exactly one folder')
		return
	}

	const path = paths[0]
	try {
		await invoke('ensure_directory', { path })
		await onFolderDrop(path)
	} catch (e) {
		onError(String(e))
	}
}

/**
 * Dock / Open With / double-click: one folder → open workspace;
 * one `.pile` file → import pack; anything else → error.
 */
export async function applyOpenedPaths(
	paths: string[],
	{ onFolderDrop, onPileOpen, onError }: OpenedPathHandlers,
): Promise<void> {
	if (paths.length !== 1) {
		onError('Open exactly one folder or .pile file')
		return
	}

	const path = paths[0]!
	try {
		const kind = await classify_path(path)
		if (kind === 'directory') {
			await invoke('ensure_directory', { path })
			await onFolderDrop(path)
			return
		}
		if (kind === 'file' && is_pile_file(path)) {
			await onPileOpen(path)
			return
		}
		onError('Open a folder or a .pile workspace file')
	} catch (e) {
		onError(String(e))
	}
}

/**
 * Window drop: one directory → open workspace; one `.pile` → import pack;
 * only other files → import into the opened folder; mixed → error.
 */
export async function applyWorkspaceDropPaths(
	paths: string[],
	{ onFolderDrop, onFilesDrop, onPileOpen, onError }: WorkspaceDropHandlers,
): Promise<void> {
	if (paths.length === 0) {
		onError('Nothing was dropped')
		return
	}

	let directories: string[]
	let files: string[]
	try {
		const kinds = await Promise.all(paths.map(async (path) => ({
			path,
			kind: await classify_path(path),
		})))
		directories = kinds.filter(k => k.kind === 'directory').map(k => k.path)
		files = kinds.filter(k => k.kind === 'file').map(k => k.path)
		const other = kinds.filter(k => k.kind === 'other')
		if (other.length > 0) {
			onError('Unsupported drop item')
			return
		}
	} catch (e) {
		onError(String(e))
		return
	}

	if (directories.length === 1 && files.length === 0) {
		await onFolderDrop(directories[0])
		return
	}

	if (directories.length === 0 && files.length > 0) {
		const pile_files = files.filter(is_pile_file)
		const other_files = files.filter((path) => !is_pile_file(path))
		if (pile_files.length === 1 && other_files.length === 0) {
			await onPileOpen(pile_files[0]!)
			return
		}
		if (pile_files.length > 0) {
			onError('Drop exactly one .pile file to import a workspace')
			return
		}
		await onFilesDrop(files)
		return
	}

	if (directories.length > 1) {
		onError('Drop exactly one folder')
		return
	}

	onError('Drop either one folder, one .pile file, or only files')
}

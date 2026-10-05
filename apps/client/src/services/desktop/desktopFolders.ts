import { invoke } from '@tauri-apps/api/core'
import { homeDir, join } from '@tauri-apps/api/path'
import { mkdir, readDir, remove, stat } from '@tauri-apps/plugin-fs'
import type { Desktop } from '@/domain/Desktop'
import { create_window_manager } from '../window/WindowManager'

/**
 * On-disk layout for desktop children (Tauri only): each desktop owns a
 * folder `~/Pile Commander/desktops/<desktop.id>/` opened through the
 * regular local FileManager — unless the desktop was created at a custom
 * location, in which case the picked user folder itself is the root
 * (Desktop.path). Default folders are named by desktop.id, not
 * desktop.name, so renaming a desktop never breaks paths.
 */

/** Pure: which entries of the desktops root belong to no live desktop. */
export
function orphaned_desktop_ids(existing_names: string[], valid_ids: Set<string>): string[] {
	return existing_names.filter(name => !valid_ids.has(name))
}

export
async function desktops_root_path(): Promise<string> {
	return join(await homeDir(), 'Pile Commander', 'desktops')
}

/** Effective desktop root: the adopted folder when set, else the default id-folder. */
export
async function desktop_root_path(desktop: Desktop): Promise<string> {
	if (desktop.path) return desktop.path
	return join(await desktops_root_path(), desktop.id)
}

/** Adopted folder went missing outside the app — it is never recreated silently. */
export
class DesktopFolderMissingError extends Error {
	readonly path: string
	constructor(path: string) {
		super(`The desktop folder is missing: ${path}`)
		this.name = 'DesktopFolderMissingError'
		this.path = path
	}
}

/**
 * Resolves the desktop root for opening (the workspace root id). Default
 * folders are created on demand; adopted folders must already exist.
 */
export
async function ensure_desktop_folder(desktop: Desktop): Promise<string> {
	if (desktop.path) {
		const info = await stat(desktop.path).catch(() => null)
		if (!info?.isDirectory) throw new DesktopFolderMissingError(desktop.path)
		return desktop.path
	}
	const path = await desktop_root_path(desktop)
	await mkdir(path, { recursive: true })
	return path
}

/**
 * Desktop removal deletes user files — reversible via the OS trash.
 * Default folders only: adopted folders are detached, never trashed
 * (useRemoveDesktop branches on desktop.path before calling this).
 */
export
async function remove_desktop_folder(desktop: Desktop): Promise<void> {
	if (desktop.path) throw new Error('adopted desktop folders are detached, never trashed')
	await invoke('trash_path', { path: await desktop_root_path(desktop) })
}

/** False when the folder is missing or unreadable (never created, web). */
export
async function desktop_folder_has_children(desktop: Desktop): Promise<boolean> {
	try {
		return (await readDir(await desktop_root_path(desktop))).length > 0
	} catch {
		return false
	}
}

/**
 * Deletes default-root folders whose ids are not in `valid_ids` (e.g.
 * left behind after a localStorage reset). Adopted folders live outside
 * the root and are never touched. A missing root is not an error —
 * there is simply nothing to prune.
 */
export
async function prune_orphaned_desktop_folders(valid_ids: string[]): Promise<string[]> {
	const root = await desktops_root_path()
	let entries
	try {
		entries = await readDir(root)
	} catch {
		return []
	}
	const orphans = orphaned_desktop_ids(
		entries.filter(e => e.isDirectory && e.name).map(e => e.name!),
		new Set(valid_ids),
	)
	for (const name of orphans) {
		await remove(await join(root, name), { recursive: true })
	}
	return orphans
}

/** Pure picker validation; null = the folder can be adopted as a desktop root. */
export
function validate_desktop_folder_path(
	path: string,
	home: string,
	taken_paths: string[],
): string | null {
	const root = home.replace(/[/\\]+$/, '')
	if (path !== root && !path.startsWith(`${root}/`) && !path.startsWith(`${root}\\`)) {
		return 'A desktop folder must live inside your home folder'
	}
	if (path === root) return 'Pick a subfolder, not the home folder itself'
	if (taken_paths.includes(path)) return 'This folder is already used by another desktop'
	return null
}

export
type PickDesktopFolderResult =
	| { status: 'ok'; path: string; name: string }
	| { status: 'canceled' }
	| { status: 'error'; message: string }

const wm = create_window_manager()

/**
 * "Local desktop at custom location…": native folder picker + validation.
 * taken_paths = folders already adopted by other desktops (two boards on
 * one folder would fight over the entry position xattrs).
 */
export
async function pick_desktop_folder(taken_paths: string[]): Promise<PickDesktopFolderResult> {
	const picked = await wm.pick_folder({ title: 'Choose a folder for the new desktop' })
	if (!picked) return { status: 'canceled' }
	const message = validate_desktop_folder_path(picked.folder_id, await homeDir(), taken_paths)
	if (message) return { status: 'error', message }
	return { status: 'ok', path: picked.folder_id, name: picked.name }
}

import type { FolderRef } from '@/domain/Drive'
import { normalize_workspace_id } from '@/services/workspace/paths'

/**
 * A folder's own icon, as the prototype let you choose it. It lives in the
 * folder's cover, which also holds a color or a picture link (the board's
 * tile): "icon:<name>;<color>". The old interface does not read this value
 * and shows the folder as before
 */
export type FolderIcon = { icon: string; color: string }

const ICON_COVER = /^icon:([^;]+)(?:;(.*))?$/

export function read_folder_icon(cover: string | undefined): FolderIcon | null {
	const match = cover ? ICON_COVER.exec(cover) : null
	return match ? { icon: match[1]!, color: match[2] ?? '' } : null
}

export function write_folder_icon(icon: FolderIcon): string {
	return icon.color ? `icon:${icon.icon};${icon.color}` : `icon:${icon.icon}`
}

/** The prototype's choices: no color first */
export const FOLDER_ICON_COLORS = ['', '#378ADD', '#7F77DD', '#D4537E', '#D85A30', '#BA7517', '#1D9E75', '#5F5E5A']

export const FOLDER_ICONS = [
	'tabler:folder',
	'tabler:star',
	'tabler:heart',
	'tabler:rocket',
	'tabler:briefcase',
	'tabler:camera',
	'tabler:music',
	'tabler:book',
	'tabler:bulb',
	'tabler:flag',
	'tabler:package',
	'tabler:code',
]

/** macOS's own folders in ~ keep their monochrome icons, as in Finder and the prototype */
const STANDARD_FOLDERS: Record<string, string> = {
	Desktop: 'tabler:device-desktop',
	Documents: 'tabler:file-text',
	Downloads: 'tabler:download',
	Pictures: 'tabler:photo',
	Music: 'tabler:music',
	Movies: 'tabler:movie',
	Applications: 'tabler:apps',
	Public: 'tabler:users',
	Library: 'tabler:building-warehouse',
}

/** The standard icon of a folder right inside ~, if it is one of macOS's */
export function standard_folder_icon(ref: FolderRef, home: string | null): string | null {
	if (ref.drive_id !== 'local' || !home) return null
	const id = normalize_workspace_id(ref.folder_id)
	const prefix = `${home}/`
	if (!id.startsWith(prefix)) return null
	const name = id.slice(prefix.length)
	if (name.includes('/')) return null
	return STANDARD_FOLDERS[name] ?? null
}

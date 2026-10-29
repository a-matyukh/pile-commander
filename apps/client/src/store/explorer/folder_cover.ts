import type { FolderRef } from '@/domain/Drive'
import { t } from '@/i18n'
import { normalize_workspace_id } from '@/services/workspace/paths'

/**
 * A folder's own icon, as the prototype let you choose it, apart from its
 * cover (a color or a picture: the board's tile), as Finder and Milanote
 * keep them apart. It lives in the folder's `icon` attribute:
 * "<name>;<color>", without a color it is drawn monochrome. "none" clears
 * it. The old interface does not read it
 */
export type FolderIcon = { icon: string; color: string }

export const ICON_XATTR = 'icon'

const ICON_VALUE = /^([a-z0-9-]+:[a-z0-9-]+)(?:;(.*))?$/

export function read_folder_icon(value: string | undefined): FolderIcon | null {
	const match = value ? ICON_VALUE.exec(value) : null
	return match ? { icon: match[1]!, color: match[2] ?? '' } : null
}

export function write_folder_icon(icon: FolderIcon): string {
	return icon.color ? `${icon.icon};${icon.color}` : icon.icon
}

/** The folder's own icon from its attributes */
export function folder_icon_of(xattrs: readonly { name: string; value: string }[] | undefined): FolderIcon | null {
	return read_folder_icon(xattrs?.find(xattr => xattr.name === ICON_XATTR)?.value)
}

/** The prototype's choices: no color first */
export const FOLDER_ICON_COLORS = ['', '#378ADD', '#7F77DD', '#D4537E', '#D85A30', '#BA7517', '#1D9E75', '#5F5E5A']

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

/** The on-disk name of one of macOS's own folders right inside ~ (Downloads…); null otherwise */
export function system_folder(ref: FolderRef, home: string | null): string | null {
	if (ref.drive_id !== 'local' || !home) return null
	const id = normalize_workspace_id(ref.folder_id)
	const prefix = `${home}/`
	if (!id.startsWith(prefix)) return null
	const name = id.slice(prefix.length)
	return !name.includes('/') && name in STANDARD_FOLDERS ? name : null
}

/** The standard icon of a folder right inside ~, if it is one of macOS's */
export function standard_folder_icon(ref: FolderRef, home: string | null): string | null {
	const name = system_folder(ref, home)
	return name ? STANDARD_FOLDERS[name]! : null
}

/**
 * Its name in the interface language, as Finder shows "Загрузки" for
 * Downloads; the folder on disk keeps its name
 */
export function system_folder_name(ref: FolderRef, home: string | null): string | null {
	const name = system_folder(ref, home)
	return name ? t(`system_folders.${name}`) : null
}

import type { FolderRef } from '@/domain/Drive'
import type { FolderView } from '@/domain/Widget'
import { normalize_workspace_id, parent_folder_id_from_node_id, path_separator } from '@/services/workspace/paths'

/**
 * Icon and color of each view in the folder header, as in the prototype.
 * `grid` is the gallery: the stored value stays `grid` until stage 4.
 * null color: the standard view, drawn monochrome
 */
export const FOLDER_VIEW_META: Record<FolderView, { icon: string; color: string | null; label_key: string }> = {
	list: { icon: 'tabler:list', color: null, label_key: 'views.list' },
	grid: { icon: 'tabler:layout-grid', color: '#D4537E', label_key: 'views.gallery' },
	board: { icon: 'tabler:template', color: '#534AB7', label_key: 'views.board' },
	canvas: { icon: 'tabler:artboard', color: '#1D9E75', label_key: 'views.canvas' },
	stack: { icon: 'tabler:layout-rows', color: '#BA7517', label_key: 'views.stack' },
	masonry: { icon: 'tabler:layout-cards', color: '#D85A30', label_key: 'views.masonry' },
	slides: { icon: 'tabler:presentation', color: '#639922', label_key: 'views.slides' },
}

/** How a crumb looks: the home glyph, a drive icon, or its name */
export type CrumbGlyph = 'home' | 'cloud' | 'browser' | null

export type FolderCrumb = {
	/** null: not a folder (the cloud drive itself), shown but not clickable */
	ref: FolderRef | null
	name: string
	glyph: CrumbGlyph
}

export type CrumbNames = {
	/** Is this local root the home folder */
	is_home(root_id: string): boolean
	/** Name of a root: a cloud workspace, a folder outside ~, browser storage */
	root_name(ref: FolderRef): string
	/** Name of a folder below its root (a browser folder keeps its old list name) */
	folder_name(ref: FolderRef): string
	cloud_name: string
}

/** Cloud folders are paths from `/`. `root_id` there is the workspace UUID. */
export function root_folder_id(ref: Pick<FolderRef, 'drive_id' | 'root_id'>): string {
	return ref.drive_id === 'cloud' ? '/' : normalize_workspace_id(ref.root_id)
}

export function folder_basename(id: string): string {
	const trimmed = normalize_workspace_id(id)
	const index = trimmed.lastIndexOf(path_separator(trimmed))
	const name = index === -1 ? trimmed : trimmed.slice(index + 1)
	return name || trimmed
}

function crumb_for(ref: FolderRef, names: CrumbNames): FolderCrumb {
	if (ref.folder_id !== root_folder_id(ref)) return { ref, name: names.folder_name(ref), glyph: null }
	if (ref.drive_id === 'local' && names.is_home(ref.root_id)) return { ref, name: names.root_name(ref), glyph: 'home' }
	if (ref.drive_id === 'browser') return { ref, name: names.root_name(ref), glyph: 'browser' }
	return { ref, name: names.root_name(ref), glyph: null }
}

/** Title of the open folder: its name, or the root's name at a root */
export function folder_title(ref: FolderRef, names: CrumbNames): string {
	return crumb_for(ref, names).name
}

/**
 * Parents of the open folder, from the drive down, without the folder itself.
 * Each one opens its folder. In the cloud the path starts at the cloud icon:
 * the user sees one cloud with top-level folders, not workspaces
 */
export function folder_crumbs(ref: FolderRef, names: CrumbNames): FolderCrumb[] {
	const root = root_folder_id(ref)
	const ids: string[] = []
	let current = normalize_workspace_id(ref.folder_id)
	while (current !== root) {
		const parent = parent_folder_id_from_node_id(current, root)
		if (parent === current) break
		ids.unshift(parent)
		current = parent
	}
	const crumbs = ids.map(folder_id => crumb_for({ ...ref, folder_id }, names))
	if (ref.drive_id === 'cloud') crumbs.unshift({ ref: null, name: names.cloud_name, glyph: 'cloud' })
	return crumbs
}

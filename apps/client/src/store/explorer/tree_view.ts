import { useStorage } from '@vueuse/core'
import type { FolderRef } from '@/domain/Drive'
import { FOLDER_VIEWS, folder_view_from_stored, type FolderView } from '@/domain/Widget'
import type { WorkspaceTree, WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import type { FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import { xattrs_map } from '@/services/workspace/xattrs'
import { is_within } from './drives'

export type TreeFilterKey = 'all' | 'custom_view' | 'bookmarked' | 'synced' | 'shared' | 'public_link' | 'in_hub'

/** Filters of the sidebar tree, in menu order; `all` comes first, then a separator */
export const TREE_FILTERS: Record<TreeFilterKey, { icon: string }> = {
	all: { icon: 'tabler:folders' },
	custom_view: { icon: 'tabler:palette' },
	bookmarked: { icon: 'tabler:bookmark' },
	synced: { icon: 'tabler:cloud-check' },
	shared: { icon: 'tabler:users' },
	public_link: { icon: 'tabler:link' },
	in_hub: { icon: 'tabler:world' },
}

/** Sort by date waits until a FileManager reports modified times (see the plan) */
export type TreeSortKey = 'name' | 'kind'

export const TREE_SORTS: Record<TreeSortKey, { icon: string }> = {
	name: { icon: 'tabler:sort-ascending-letters' },
	kind: { icon: 'tabler:palette' },
}

export type TreeSortDirection = 'asc' | 'desc'

export type TreeViewSettings = {
	filter: TreeFilterKey
	sort: TreeSortKey
	direction: TreeSortDirection
}

const DEFAULT_TREE_VIEW: TreeViewSettings = { filter: 'all', sort: 'name', direction: 'asc' }

/** Per device. A display setting only: it never changes what is on disk or in the cloud */
export const explorer_tree_view = useStorage<TreeViewSettings>(
	'pile_commander_explorer_tree_view',
	{ ...DEFAULT_TREE_VIEW },
	undefined,
	{ mergeDefaults: true },
)

export const is_tree_filtered = (settings: TreeViewSettings) => settings.filter !== 'all'
export const is_tree_sort_changed = (settings: TreeViewSettings) =>
	settings.sort !== DEFAULT_TREE_VIEW.sort || settings.direction !== DEFAULT_TREE_VIEW.direction

/** What a filter needs to know about one root of a drive */
export type TreeFilterSources = {
	/** The root as FolderRef parts, and its root folder id ("/" in the cloud) */
	drive_id: string
	root_id: string
	root_folder_id: string
	cloud: boolean
	bookmarks: readonly FolderRef[]
	/** Local folder paths linked to a cloud workspace on this device */
	sync_roots: readonly string[]
	/** Cloud: this root is synced with a local folder on this device */
	cloud_synced: boolean
	cloud_shared: boolean
	cloud_public_link: boolean
	cloud_in_hub: boolean
	/** Folders already read, with their children's attributes */
	folders: Readonly<Record<string, FolderWithChildrenXattrs>>
}

/** The view a folder entry carries in its attributes, `list` when none ("gallery" and "grid" are Gallery) */
export function entry_view(entry: { xattrs: { name: string; value: string }[] } | undefined): FolderView {
	return folder_view_from_stored(entry ? xattrs_map(entry.xattrs).view : undefined)
}

/**
 * Folder ids of this root the filter matches, or null for `all`. Everything
 * but `custom_view` is known up front (bookmarks, sync links, cloud flags).
 * `custom_view` sees only folders already read: the tree never reads all of ~
 */
export function matching_folder_ids(filter: TreeFilterKey, sources: TreeFilterSources): Set<string> | null {
	const ids = new Set<string>()
	const root_matches = (yes: boolean) => {
		if (yes) ids.add(sources.root_folder_id)
	}
	switch (filter) {
		case 'all':
			return null
		case 'bookmarked':
			for (const ref of sources.bookmarks) {
				if (ref.drive_id === sources.drive_id && ref.root_id === sources.root_id) ids.add(ref.folder_id)
			}
			break
		case 'synced':
			if (sources.cloud) root_matches(sources.cloud_synced)
			else for (const root of sources.sync_roots) {
				// A link inside this root, or one this whole root sits in
				if (is_within(root, sources.root_folder_id)) ids.add(root)
				else if (is_within(sources.root_folder_id, root)) ids.add(sources.root_folder_id)
			}
			break
		case 'shared':
			root_matches(sources.cloud && sources.cloud_shared)
			break
		case 'public_link':
			root_matches(sources.cloud && sources.cloud_public_link)
			break
		case 'in_hub':
			root_matches(sources.cloud && sources.cloud_in_hub)
			break
		case 'custom_view':
			for (const folder of Object.values(sources.folders)) {
				// The folder itself (a root's own view counts too), then its children
				if (entry_view(folder) !== 'list') ids.add(folder.id)
				for (const child of folder.children) {
					if (child.type === 'folder' && entry_view(child) !== 'list') ids.add(child.id)
				}
			}
			break
	}
	return ids
}

/**
 * Shown under a filter: a match, a folder on the way to one, or a folder
 * inside one (a matching folder can still be browsed)
 */
export function is_folder_shown(folder_id: string, matches: Set<string> | null): boolean {
	if (!matches) return true
	for (const id of matches) {
		if (is_within(folder_id, id) || is_within(id, folder_id)) return true
	}
	return false
}

const name_collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/**
 * Children in the tree's order. `kind` groups by view in the order the view
 * menu lists them, then by name; `desc` reverses the whole list
 */
export function sort_tree_children(
	nodes: WorkspaceTree,
	settings: Pick<TreeViewSettings, 'sort' | 'direction'>,
	view_of: (node: WorkspaceTreeNode) => FolderView,
): WorkspaceTree {
	const rank = (node: WorkspaceTreeNode) => FOLDER_VIEWS.indexOf(view_of(node))
	const sorted = nodes.slice().sort((a, b) => {
		if (settings.sort === 'kind') {
			const by_kind = rank(a) - rank(b)
			if (by_kind !== 0) return by_kind
		}
		return name_collator.compare(a.name, b.name)
	})
	return settings.direction === 'desc' ? sorted.reverse() : sorted
}

import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import cloud from '@/store/cloud'
import { sync_link_roots, synced_folder_of } from '@/store/localSync'
import { show_hidden_files } from '@/store/showHiddenFiles'
import { explorer_bookmarks } from './bookmarks'
import { tree_root_folder_id, visible_folder_children, type ExplorerTreeRoot } from './tree'
import {
	entry_view,
	explorer_tree_view,
	is_folder_shown,
	matching_folder_ids,
	sort_tree_children,
	type TreeFilterSources,
} from './tree_view'

/**
 * The root's store while it is open. Drive disposes the store of a collapsed
 * root, and its folders stop being kept current (no watch, no realtime)
 */
function live_store(item: ExplorerTreeRoot) {
	return item.workspace && !item.workspace.is_disposed ? item.workspace : null
}

function filter_sources(item: ExplorerTreeRoot): TreeFilterSources {
	const is_cloud = item.drive.kind === 'cloud'
	const root_id = item.root.id
	return {
		drive_id: item.drive.id,
		root_id,
		root_folder_id: tree_root_folder_id(item),
		cloud: is_cloud,
		bookmarks: explorer_bookmarks.value,
		sync_roots: is_cloud ? [] : sync_link_roots(),
		cloud_synced: is_cloud && synced_folder_of(root_id) !== null,
		cloud_shared: is_cloud && cloud.shared_out[root_id] === true,
		cloud_public_link: is_cloud && root_id in cloud.published_slugs,
		cloud_in_hub: is_cloud && cloud.hub_listed[root_id] === true,
		folders: live_store(item)?.folders ?? {},
	}
}

/** Folder ids of this root the current filter matches; null when nothing is filtered */
function matches_of(item: ExplorerTreeRoot) {
	return matching_folder_ids(explorer_tree_view.value.filter, filter_sources(item))
}

/**
 * The children of `parent_id` as the tree shows them: folders only, dot
 * names per the setting, the filter, then the sort
 */
export function arranged_children(item: ExplorerTreeRoot, parent_id: string, nodes: WorkspaceTree): WorkspaceTree {
	const matches = matches_of(item)
	const shown = visible_folder_children(nodes, show_hidden_files.value)
		.filter(node => is_folder_shown(node.id, matches))
	const parent = live_store(item)?.folders[parent_id]
	return sort_tree_children(shown, explorer_tree_view.value, node =>
		entry_view(parent?.children.find(child => child.id === node.id)))
}

/**
 * Separate roots (cloud workspaces, folders outside ~): filtered, then by
 * name. A root without an open store (never read, or closed when collapsed)
 * stays under `custom_view`: its views are unknown, not absent, and it has to
 * stay visible to be opened
 */
export function arranged_roots(items: readonly ExplorerTreeRoot[]): ExplorerTreeRoot[] {
	const unknown = (item: ExplorerTreeRoot) => explorer_tree_view.value.filter === 'custom_view' && !live_store(item)
	const shown = items.filter(item => unknown(item) || is_folder_shown(tree_root_folder_id(item), matches_of(item)))
	const by_name = sort_tree_children(
		shown.map(item => ({ id: `${item.drive.id}\0${item.root.id}`, name: item.root.name, type: 'folder' as const })),
		{ ...explorer_tree_view.value, sort: 'name' },
		() => 'list',
	)
	return by_name.map(node => shown.find(item => `${item.drive.id}\0${item.root.id}` === node.id)!)
}

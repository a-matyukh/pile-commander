import type { EntryWithXattrs, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import type { WorkspaceTree, WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { sort_entries_by_order_then_name } from './folderContainer'
import {
	parent_folder_id_from_node_id,
	rename_ids_in_set,
} from './paths'

export type TreeProjectionState = {
	id: string
	tree: WorkspaceTree
	folders: Record<string, FolderWithChildrenXattrs>
	tree_loaded_folder_ids: Set<string>
}

export { parent_folder_id_from_node_id, rename_ids_in_set }

export function find_tree_node(tree: WorkspaceTree, id: string): WorkspaceTreeNode | null {
	for (const node of tree) {
		if (node.id === id) return node
		if (node.children) {
			const found = find_tree_node(node.children, id)
			if (found) return found
		}
	}
	return null
}

export function find_tree_parent(
	tree: WorkspaceTree,
	id: string,
	parent_list: WorkspaceTree = tree,
): { parent_list: WorkspaceTree; index: number; node: WorkspaceTreeNode } | null {
	for (let i = 0; i < tree.length; i++) {
		if (tree[i].id === id) {
			return { parent_list, index: i, node: tree[i] }
		}
		if (tree[i].children) {
			const found = find_tree_parent(tree[i].children!, id, tree[i].children!)
			if (found) return found
		}
	}
	return null
}

export function is_descendant(tree: WorkspaceTree, ancestor_id: string, id: string): boolean {
	if (ancestor_id === id) return true
	const ancestor = find_tree_node(tree, ancestor_id)
	if (!ancestor?.children) return false
	return find_tree_node(ancestor.children, id) !== null
}

export function find_folder_id_for_list(
	tree: WorkspaceTree,
	root_id: string,
	list: WorkspaceTree,
): string | null {
	if (list === tree) return root_id
	for (const node of tree) {
		if (node.children === list) return node.id
		if (node.children) {
			const found = find_folder_id_for_list(node.children, root_id, list)
			if (found) return found
		}
	}
	return null
}

export function folder_children_list(
	tree: WorkspaceTree,
	root_id: string,
	folder_id: string,
): WorkspaceTree | undefined {
	if (folder_id === root_id) return tree
	return find_tree_node(tree, folder_id)?.children
}

/** Path from workspace root to `folder_id`, inclusive (empty for workspace root). */
export function folder_ancestor_chain(folder_id: string, workspace_id: string): string[] {
	if (folder_id === workspace_id) return []

	const chain: string[] = []
	let current = folder_id
	while (current !== workspace_id) {
		chain.unshift(current)
		current = parent_folder_id_from_node_id(current, workspace_id)
	}
	return chain
}

function project_entry(
	entry: EntryWithXattrs,
	folders: Record<string, FolderWithChildrenXattrs>,
	tree_loaded_folder_ids: Set<string>,
): WorkspaceTreeNode {
	if (entry.type !== 'folder') {
		return { id: entry.id, name: entry.name, type: entry.type }
	}

	const cached = folders[entry.id]
	const loaded = tree_loaded_folder_ids.has(entry.id) && !!cached
	if (!loaded) {
		return { id: entry.id, name: entry.name, type: 'folder', children_loaded: false }
	}

	return {
		id: entry.id,
		name: entry.name,
		type: 'folder',
		children_loaded: true,
		children: sort_entries_by_order_then_name(cached!.children ?? []).map(child =>
			project_entry(child, folders, tree_loaded_folder_ids),
		),
	}
}

/** Builds a fresh tree from the folder cache and which folders are expanded in the sidebar. */
export function project_tree(state: TreeProjectionState): WorkspaceTree {
	const root = state.folders[state.id]
	if (!root) return []
	return sort_entries_by_order_then_name(root.children ?? []).map(entry =>
		project_entry(entry, state.folders, state.tree_loaded_folder_ids),
	)
}

/** Replaces `state.tree` in place so vuedraggable keeps the same array reference. */
export function sync_tree_from_folders(state: TreeProjectionState): void {
	const next = project_tree(state)
	state.tree.splice(0, state.tree.length, ...next)
}

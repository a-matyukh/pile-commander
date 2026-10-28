import { reactive } from 'vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { normalize_workspace_id } from '@/services/workspace/paths'
import { is_within } from './drives'
import { explorer_tree, type ExplorerTreeRoot } from './tree'

/**
 * "Cut", "Copy" and "Paste" for folders in the Explorer (the folder header's
 * and the tree's "⋯"). A cut folder pastes the way a drag drops it: within
 * its root it moves, into another root or drive it is transferred, with the
 * bookmarks and the open place following. A copied folder stays where it was
 * and can be pasted again. Files join with step 3.3
 */
export type FolderClip = {
	mode: 'copy' | 'cut'
	item: ExplorerTreeRoot
	node: WorkspaceTreeNode
	name: string
}

type ClipboardTree = Pick<typeof explorer_tree, 'move_folder' | 'transfer_folder' | 'copy_folder'>

function same_root(a: ExplorerTreeRoot, b: ExplorerTreeRoot): boolean {
	return a.drive.id === b.drive.id && a.root.id === b.root.id
}

export function create_folder_clipboard(tree: ClipboardTree) {
	const state = reactive<{ clip: FolderClip | null }>({ clip: null })

	/** Never into the folder itself or its own subfolder */
	function can_paste(target: ExplorerTreeRoot, target_folder_id: string): boolean {
		const clip = state.clip
		if (!clip) return false
		if (!same_root(clip.item, target)) return true
		const folder = normalize_workspace_id(target_folder_id)
		return !is_within(folder, normalize_workspace_id(clip.node.id))
	}

	async function paste(target: ExplorerTreeRoot, target_folder_id: string) {
		const clip = state.clip
		if (!clip || !can_paste(target, target_folder_id)) return
		if (clip.mode === 'copy') {
			await tree.copy_folder(clip.item, clip.node, target, target_folder_id)
			return
		}
		state.clip = null
		if (same_root(clip.item, target)) await tree.move_folder(clip.item, clip.node, target_folder_id)
		else await tree.transfer_folder(clip.item, clip.node, target, target_folder_id)
	}

	return {
		get clip() { return state.clip },
		copy(item: ExplorerTreeRoot, node: WorkspaceTreeNode, name: string) {
			state.clip = { mode: 'copy', item, node, name }
		},
		cut(item: ExplorerTreeRoot, node: WorkspaceTreeNode, name: string) {
			state.clip = { mode: 'cut', item, node, name }
		},
		clear() {
			state.clip = null
		},
		/** The cut folder is dimmed in the tree until it is pasted */
		is_cut(item: ExplorerTreeRoot, folder_id: string): boolean {
			const clip = state.clip
			return clip?.mode === 'cut' && same_root(clip.item, item) && clip.node.id === folder_id
		},
		can_paste,
		paste,
	}
}

export const explorer_folder_clipboard = create_folder_clipboard(explorer_tree)

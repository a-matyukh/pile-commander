import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'

/**
 * Ids for Cut/Copy/Duplicate/Remove from a node menu: the pane's multi-selection
 * when the node is selected among others; otherwise just the menu node.
 * Pass `children` (folder-scope widgets) so nested previews aren't limited to
 * `opened_folder`; menu items are built inside computeds where inject() is unavailable.
 */
export function clipboardIdsForMenu(
	node: WorkspaceTreeNode,
	ws: WorkspaceStore,
	children?: readonly { id: string }[],
): string[] {
	if (ws.is_selected(node.id) && ws.selection.length > 1) {
		const child_ids = new Set((children ?? ws.opened_folder.children ?? []).map(c => c.id))
		const selected = ws.selection.filter(id => child_ids.has(id))
		if (selected.length > 0) return selected
	}
	return [node.id]
}

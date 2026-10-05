import { computed, toValue, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'

/** Maps a widget to the menu node shape; usable directly in v-for templates. */
export function menuNodeFor(widget: FolderContainerWidgetChild): WorkspaceTreeNode {
	return {
		id: widget.id,
		name: widget.name,
		type: widget.type === 'file' ? 'file' : 'folder',
	}
}

export function useMenuNode(widget: MaybeRefOrGetter<FolderContainerWidgetChild>) {
	return computed<WorkspaceTreeNode>(() => menuNodeFor(toValue(widget)))
}

<script setup lang="ts">
import { computed } from 'vue'
import draggable from 'vuedraggable'
import type { MoveEvent } from 'sortablejs'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import TreeItemRow from './TreeItemRow.vue'
import TreeItemChildren from './TreeItemChildren.vue'
import { find_tree_node } from '@/services/workspace/tree'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useTreeDragState } from './treeDragState'

const { parent_id, list } = defineProps<{
	parent_id: string
	list: WorkspaceTreeNode[]
}>()

const { is_tree_dragging, pending_removals } = useTreeDragState()

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()
const can_write = computed(() => workspace.value?.can_write !== false)

const group = { name: 'workspace-tree', pull: true, put: true }

function expand_folder(folder_id: string) {
	requireWorkspace().prepare_folder_for_drop(
		folder_id,
		() => !is_tree_dragging.value,
	)
}

function on_change(evt: {
	added?: { element: WorkspaceTreeNode; newIndex: number }
	removed?: { element: WorkspaceTreeNode; oldIndex: number }
	moved?: { element: WorkspaceTreeNode; oldIndex: number; newIndex: number }
}) {
	const ws = requireWorkspace()

	if (evt.removed) {
		pending_removals.set(evt.removed.element.id, {
			parent_id,
			old_index: evt.removed.oldIndex,
		})
	}

	if (evt.added) {
		const { element, newIndex } = evt.added
		const pending = pending_removals.get(element.id)
		pending_removals.delete(element.id)
		void ws.move(
			element.id,
			parent_id,
			newIndex,
			pending?.parent_id,
			pending?.old_index,
		)
	}

	if (evt.moved) {
		void ws.move(
			evt.moved.element.id,
			parent_id,
			evt.moved.newIndex,
			parent_id,
			evt.moved.oldIndex,
		)
	}
}

function on_move(evt: MoveEvent) {
	const target = evt.to as HTMLElement
	const target_folder_id = target.dataset.parentId
	if (target_folder_id) {
		expand_folder(target_folder_id)
	}

	const related = evt.related as HTMLElement | null
	const folder_row = related?.closest<HTMLElement>('[data-folder-id]')
	if (folder_row?.dataset.folderId) {
		expand_folder(folder_row.dataset.folderId)
	}

	return true
}

function on_start() {
	is_tree_dragging.value = true
}

function on_end() {
	is_tree_dragging.value = false

	const ws = requireWorkspace()
	for (const folder_id of ws.expanded_folder_ids) {
		const folder = find_tree_node(ws.tree, folder_id)
		if (folder?.type === 'folder' && !folder.children_loaded) {
			void ws.show_folder_children(folder_id, () => !is_tree_dragging.value)
		}
	}
}
</script>

<template>
	<draggable
		:list="list"
		item-key="id"
		:group="group"
		handle=".drag-handle"
		:disabled="!can_write"
		:animation="150"
		:empty-insert-threshold="20"
		:swap-threshold="0.65"
		:fallback-on-body="true"
		:force-fallback="true"
		ghost-class="tree-drag-ghost"
		chosen-class="tree-drag-chosen"
		tag="div"
		class="tree-list"
		:data-parent-id="parent_id"
		@change="on_change"
		@move="on_move"
		@start="on_start"
		@end="on_end"
	>
		<template #item="{ element }">
			<div class="tree-branch">
				<TreeItemRow :node="element" />
				<TreeItemChildren :node="element" />
			</div>
		</template>
	</draggable>
</template>

<style scoped>
.tree-list {
	min-height: 0.25rem;
}
:deep(.tree-drag-ghost) {
	opacity: 0.4;
}
:deep(.tree-drag-chosen) {
	background-color: #f0f0f0;
	/* background-color: #fff; */
}
</style>

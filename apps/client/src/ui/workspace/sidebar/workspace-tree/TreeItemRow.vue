<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import FileMenu from '@/ui/workspace/menu/FileMenu.vue'
import FolderMenu from '@/ui/workspace/menu/FolderMenu.vue'
import DragHandle from '@/ui/workspace/folder-container/widgets/DragHandle.vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { useTreeDragState } from './treeDragState'

const { node } = defineProps<{
	node: WorkspaceTreeNode
}>()

const { is_tree_dragging } = useTreeDragState()

const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()

const toggle = () => {
	if (ws.is_folder_expanded(node.id)) {
		ws.toggle_folder_expanded(node.id)
	} else {
		void ws.expand_folder_in_sidebar(node.id, () => !is_tree_dragging.value)
	}
}

const is_folder = computed(() => node.type === 'folder')

/** Touch often never fires `dblclick`; detect a second click/tap instead. */
const DOUBLE_OPEN_MS = 350
let last_open_tap_at = 0

function open_node() {
	if (is_folder.value) void ws.open_folder(node.id)
	else void ws.open_file(node.id)
}

function on_name_click() {
	const now = performance.now()
	if (now - last_open_tap_at < DOUBLE_OPEN_MS) {
		last_open_tap_at = 0
		open_node()
		return
	}
	last_open_tap_at = now
}
</script>

<template>
	<div
		class="tree-item-row group flex w-full items-center"
		:class="{
			file: !is_folder,
			'pc-selected': ws.is_selected(node.id),
			'pc-cut': ws.is_cut(node.id),
			opened_folder: ws.is_opened_folder(node.id),
		}"
		:data-folder-id="is_folder ? node.id : undefined"
	>
		<span class="tree-item-lead">
			<UButton
				v-if="is_folder"
				:icon="ws.is_folder_expanded(node.id) ? 'mdi:chevron-down' : 'mdi:chevron-right'"
				color="neutral"
				variant="ghost"
				size="xs"
				square
				:ui="{ leadingIcon: 'size-5' }"
				@click="toggle"
			/>
			<UIcon v-else name="la:file" class="size-5" />
		</span>

		<span
			class="min-w-0 flex-1"
			@click="on_name_click"
			style="user-select: none"
		>
			{{ node.name }}
		</span>

		<span v-if="ws.can_write" class="tree-item-controls">
			<span class="tree-item-control">
				<DragHandle handle-class="drag-handle" />
			</span>
			<span class="tree-item-control">
				<FileMenu v-if="!is_folder" :node="node" />
				<FolderMenu
					v-else
					:node="node"
					:loading="ws.is_folder_loading(node.id)"
				/>
			</span>
		</span>
	</div>
</template>

<style scoped>
.tree-item-row {
	cursor: pointer;
	font-size: 14px;
	user-select: none;
	padding: 7px;
	touch-action: manipulation;
}
.tree-item-row.pc-selected {
	box-shadow: none;
}
.opened_folder:not(.pc-selected) {
	/* background-color: var(--pc-bg-muted); */
	background-color: #fff;
	color: var(--pc-accent);
}
.file {
	padding-block: 10px;
}
.tree-item-lead,
.tree-item-control {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
}
.tree-item-lead {
	width: 1.75rem;
	height: 1.75rem;
}
.tree-item-lead :deep(button) {
	padding: 0;
	width: 1.75rem;
	height: 1.75rem;
	justify-content: center;
}
.tree-item-controls {
	display: flex;
	flex-shrink: 0;
	align-items: center;
}
.tree-item-control {
	width: 1.5rem;
	height: 1.5rem;
}
.tree-item-control :deep(button) {
	padding: 0;
	width: 1.5rem;
	height: 1.5rem;
	justify-content: center;
}
@media (hover: hover) {
	.tree-item-controls {
		visibility: hidden;
	}
	.tree-item-row:hover .tree-item-controls {
		visibility: visible;
	}
}
</style>

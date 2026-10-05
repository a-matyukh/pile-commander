<script setup lang="ts">
import { computed } from 'vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import TreeList from './TreeList.vue'

const { node } = defineProps<{
	node: WorkspaceTreeNode
}>()

const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()

const is_folder = computed(() => node.type === 'folder')
const is_expanded = computed(() => ws.is_folder_expanded(node.id))
</script>

<template>
	<div
		v-if="is_folder && node.children !== undefined"
		class="tree-children ml-6"
		:class="{ 'tree-children--drop-only': !is_expanded }"
	>
		<TreeList :list="node.children" :parent_id="node.id" />
		<span v-if="is_expanded && node.children.length === 0" class="p-4">
			<small><em>empty folder</em></small>
		</span>
	</div>
</template>

<style scoped>
.tree-children {
	border-left: 1px dashed var(--pc-border);
}
.tree-children--drop-only {
	min-height: 6px;
	overflow: hidden;
	border-left-color: transparent;
}
.tree-children--drop-only :deep(.tree-branch) {
	visibility: hidden;
	height: 0;
	overflow: hidden;
}
</style>

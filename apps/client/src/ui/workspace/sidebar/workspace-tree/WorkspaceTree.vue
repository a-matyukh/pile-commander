<script setup lang="ts">
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import TreeList from './TreeList.vue'
import { provideTreeDragState } from './treeDragState'

provideTreeDragState()

// The tree is remounted per workspace (keyed by workspace uid in Sidebar).
// `id` is "/" for every cloud workspace, so a key on id would keep this
// instance (and its captured store) when switching clouds.
const requireWorkspace = useRequireWorkspace()
const ws = requireWorkspace()
</script>

<template>
	<aside>
		<TreeList
			:list="ws.tree"
			:parent_id="ws.id"
		/>
	</aside>
</template>

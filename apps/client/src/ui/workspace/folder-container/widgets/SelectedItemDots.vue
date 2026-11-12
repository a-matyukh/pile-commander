<script setup lang="ts">
import type { Component } from 'vue'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'

/**
 * The selected item's "⋯", as in the Gallery: its menu without a right click
 * or a long press. It neither starts a drag nor changes the selection.
 */
defineProps<{
	menuComponent: Component
	menuNode: WorkspaceTreeNode
	menuProps?: Record<string, unknown>
}>()
</script>

<template>
	<span
		class="selected-item-dots board-no-drag nodrag nopan"
		@pointerdown.stop
		@click.stop
		@dblclick.stop
	>
		<component :is="menuComponent" :node="menuNode" v-bind="menuProps ?? {}" />
	</span>
</template>

<style scoped>
/* At the top-right corner, as the Gallery's "⋯"; above the selection ring */
.selected-item-dots {
	position: absolute;
	z-index: 3;
	top: 3px;
	right: 3px;
	cursor: default;
}
</style>

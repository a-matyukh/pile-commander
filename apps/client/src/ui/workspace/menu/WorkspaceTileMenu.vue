<script setup lang="ts">
import { computed, ref } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import type { WorkspaceTile } from '@/services/cloud/desktopBoards'
import PublishDialog from '@/ui/workspace/sidebar/PublishDialog.vue'
import ShareDialog from '@/ui/workspace/sidebar/ShareDialog.vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import NodeMenuShell from './NodeMenuShell.vue'
import { useNodeMenu } from './useNodeMenu'
import { useSelectionMenu } from './useSelectionMenu'
import BulkRemoveDialog from './BulkRemoveDialog.vue'

/**
 * Context menu of a workspace tile on a cloud desktop board. The tile is a
 * real workspace (workspaces.desktop_id), so the menu mirrors the workspace
 * actions — open / rename / public link / share / remove — instead of the
 * entry-folder actions (uncombine/cut/copy make no sense across workspaces
 * and are refused by the board FileManager anyway).
 *
 * Rename/remove still go through the board's workspace store: its wrapper
 * FileManager routes tile-root operations to workspace mutations and syncs
 * the sidebar list.
 */
const props = defineProps<{
	node: WorkspaceTreeNode
	tile: WorkspaceTile
	loading?: boolean
	pressOpenDelay?: number
}>()

const {
	shellRef,
	commit_rename,
	commit_remove,
	rename_remove_items,
} = useNodeMenu(() => props.node)

const {
	isMultiSelection,
	selectionMenuItems,
	dialogRef,
	onConfirm,
} = useSelectionMenu(() => props.node)

const requireWorkspace = useRequireWorkspace()

const publish_dialog = ref<InstanceType<typeof PublishDialog> | null>(null)
const share_dialog = ref<InstanceType<typeof ShareDialog> | null>(null)

const items = computed<DropdownMenuItem[][]>(() => {
	if (isMultiSelection.value) return selectionMenuItems.value

	return [
		[
			{
				label: 'Open workspace',
				icon: 'i-lucide:folder-open',
				disabled: props.loading,
				onSelect() {
					// intercepted by desktopChildren: opens as a workspace window
					void requireWorkspace().open_folder(props.node.id)
				},
			},
			{
				label: 'Publish…',
				icon: 'i-lucide:globe',
				onSelect: () => publish_dialog.value?.open(props.tile.workspace_id),
			},
			{
				label: 'Share…',
				icon: 'i-lucide:users',
				onSelect: () => share_dialog.value?.open(props.tile.workspace_id),
			},
		],
		rename_remove_items.value,
	]
})
</script>

<template>
	<NodeMenuShell
		ref="shellRef"
		:node="node"
		:items="items"
		:press-open-delay="pressOpenDelay"
		@confirm-rename="commit_rename"
		@confirm-remove="commit_remove"
	>
		<template v-if="$slots.default" #default>
			<slot />
		</template>
	</NodeMenuShell>
	<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
	<PublishDialog ref="publish_dialog" />
	<ShareDialog ref="share_dialog" />
</template>

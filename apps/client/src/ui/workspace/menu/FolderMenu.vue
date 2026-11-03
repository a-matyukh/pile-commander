<script setup lang="ts">
import { computed } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import NodeMenuShell from './NodeMenuShell.vue'
import { useNodeMenu } from './useNodeMenu'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useSelectionMenu } from './useSelectionMenu'
import BulkRemoveDialog from './BulkRemoveDialog.vue'
import { t } from '@/i18n'
import ColorPanel from '@/ui/explorer/folder-header/ColorPanel.vue'
import BoardFolderItems from '@/ui/explorer/views/BoardFolderItems.vue'

const props = defineProps<{
	node: WorkspaceTreeNode
	loading?: boolean
	showPreviewToggle?: boolean
	isPreview?: boolean
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
	clipboardItems,
	layerItems,
	selectionMenuItems,
	sharedBackground,
	dialogRef,
	onConfirm,
	applyColor: selectionApplyColor,
} = useSelectionMenu(() => props.node)

const previewToggleLabel = computed(() =>
	props.isPreview ? 'Hide preview' : 'Preview',
)

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()
const readonly = computed(() => workspace.value?.can_write === false)

const items = computed<DropdownMenuItem[][]>(() => {
	if (isMultiSelection.value) return selectionMenuItems.value

	const open: DropdownMenuItem = {
		label: 'Open folder',
		disabled: props.loading,
		onSelect() {
			void requireWorkspace().open_folder(props.node.id)
		},
	}
	const preview: DropdownMenuItem[] = props.showPreviewToggle
		? [{
			label: previewToggleLabel.value,
			disabled: readonly.value,
			onSelect() {
				void requireWorkspace().change_is_preview(props.node.id, !props.isPreview)
			},
		}]
		: []
	const uncombine: DropdownMenuItem = {
		label: 'Uncombine',
		disabled: props.loading || readonly.value,
		onSelect() {
			void requireWorkspace().uncombine_folder(props.node.id)
		},
	}

	// Bookmark and Finder, icon and cover, "Uncombine" beside Rename and Remove
	const [rename, ...remove] = rename_remove_items.value
	return [
		[open, ...preview],
		[{ slot: 'explorer-place' as const, raw: true }],
		[{ slot: 'explorer-look' as const, raw: true }],
		...(layerItems.value.length ? [layerItems.value] : []),
		clipboardItems.value,
		[...(rename ? [rename] : []), uncombine, ...remove],
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
		<template #explorer-place>
			<BoardFolderItems :node_id="node.id" part="place" />
		</template>
		<template #explorer-look>
			<BoardFolderItems :node_id="node.id" part="look" />
		</template>
		<template #selection-color>
			<ColorPanel
				:value="sharedBackground"
				:label="t('style.background_color')"
				:reset_label="t('style.remove_background')"
				@set="value => void selectionApplyColor(value)"
			/>
		</template>
	</NodeMenuShell>
	<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
</template>

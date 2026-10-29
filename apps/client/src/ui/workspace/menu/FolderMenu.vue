<script setup lang="ts">
import { computed } from 'vue'
import { useMediaQuery } from '@vueuse/core'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import NodeMenuShell from './NodeMenuShell.vue'
import ColorPickerMenuSlot from './ColorPickerMenuSlot.vue'
import PresetColorsMenuSlot from './PresetColorsMenuSlot.vue'
import { useNodeMenu } from './useNodeMenu'
import { useColorSubmenu } from './useColorSubmenu'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useSelectionMenu } from './useSelectionMenu'
import BulkRemoveDialog from './BulkRemoveDialog.vue'
import { explorer_mounted } from '@/store/explorer/public_view'
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
	openedChild,
} = useNodeMenu(() => props.node)

const {
	isMultiSelection,
	clipboardItems,
	selectionMenuItems,
	dialogRef,
	onConfirm,
	pickerColor: selectionPickerColor,
	onPickerPointerDown: selectionOnPickerPointerDown,
	commitPickerColor: selectionCommitPickerColor,
	applyColor: selectionApplyColor,
} = useSelectionMenu(() => props.node)

const previewToggleLabel = computed(() =>
	props.isPreview ? 'Hide preview' : 'Preview',
)

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()
const readonly = computed(() => workspace.value?.can_write === false)

// Tabs live in the window header strip. Hide the new-tab item on narrow
// screens (same breakpoint as the sidebar's md: drawer switch).
const isMdUp = useMediaQuery('(min-width: 768px)')
// The Explorer has no tabs
const showOpenInNewTab = computed(() => isMdUp.value && !explorer_mounted.value)

const colorSubmenuOptions = computed(() => {
	const child = openedChild.value
	if (!child || child.type !== 'folder_cover') return null

	return {
		label: 'Cover',
		entityId: child.id,
		mode: 'cover' as const,
		currentColor: child.cover,
	}
})

const { colorMenuItem, pickerColor, onPickerPointerDown, commitPickerColor, applyColor } = useColorSubmenu(colorSubmenuOptions)

const activePickerColor = computed({
	get: () => isMultiSelection.value ? selectionPickerColor.value : pickerColor.value,
	set: (value: string) => {
		if (isMultiSelection.value) selectionPickerColor.value = value
		else pickerColor.value = value
	},
})
const activeApplyColor = computed(() =>
	isMultiSelection.value ? selectionApplyColor : applyColor,
)
const activeOnPickerPointerDown = computed(() =>
	isMultiSelection.value ? selectionOnPickerPointerDown : onPickerPointerDown,
)
const activeCommitPickerColor = computed(() =>
	isMultiSelection.value ? selectionCommitPickerColor : commitPickerColor,
)

const items = computed<DropdownMenuItem[][]>(() => {
	if (isMultiSelection.value) return selectionMenuItems.value

	const colorItem = colorMenuItem.value

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

	// The Explorer's folder menu: its bookmark and Finder, its icon and cover,
	// "Uncombine" beside Rename and Remove as "Ungroup" in its tree
	if (explorer_mounted.value) {
		const [rename, ...remove] = rename_remove_items.value
		return [
			[open, ...preview],
			[{ slot: 'explorer-place' as const, raw: true }],
			[{ slot: 'explorer-look' as const, raw: true }],
			clipboardItems.value,
			[...(rename ? [rename] : []), uncombine, ...remove],
		]
	}

	return [
		[
			open,
			...(showOpenInNewTab.value
				? [{
					label: 'Open folder in new tab',
					disabled: props.loading,
					onSelect() {
						void requireWorkspace().open_folder_in_new_tab(props.node.id)
					},
				}]
				: []),
			...preview,
			uncombine,
			...(props.showPreviewToggle && colorItem ? [colorItem as DropdownMenuItem] : []),
		],
		clipboardItems.value,
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
		<template #explorer-place>
			<BoardFolderItems :node_id="node.id" part="place" />
		</template>
		<template #explorer-look>
			<BoardFolderItems :node_id="node.id" part="look" />
		</template>
		<template #preset-colors>
			<PresetColorsMenuSlot :apply-color="activeApplyColor" />
		</template>
		<template #color-picker>
			<ColorPickerMenuSlot
				v-model="activePickerColor"
				:on-picker-pointer-down="activeOnPickerPointerDown"
				:commit-picker-color="activeCommitPickerColor"
			/>
		</template>
	</NodeMenuShell>
	<BulkRemoveDialog ref="dialogRef" @confirm="onConfirm" />
</template>

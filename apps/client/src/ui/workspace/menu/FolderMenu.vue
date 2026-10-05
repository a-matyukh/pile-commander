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
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useSelectionMenu } from './useSelectionMenu'
import BulkRemoveDialog from './BulkRemoveDialog.vue'

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
const { fixedView } = useFolderContainerScope()
const readonly = computed(() => workspace.value?.can_write === false)

// Tabs live in the window header strip. Hide the new-tab item on the
// desktop surface (no window tabs) and on narrow screens (same breakpoint
// as the sidebar's md: drawer switch in WorkspaceWindow).
const isMdUp = useMediaQuery('(min-width: 768px)')
const showOpenInNewTab = computed(() => isMdUp.value && !fixedView)

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

	return [
		[
		{
			label: 'Open folder',
			disabled: props.loading,
			onSelect() {
				void requireWorkspace().open_folder(props.node.id)
			},
		},
		...(showOpenInNewTab.value
			? [{
				label: 'Open folder in new tab',
				disabled: props.loading,
				onSelect() {
					void requireWorkspace().open_folder_in_new_tab(props.node.id)
				},
			}]
			: []),
			...(props.showPreviewToggle
				? [{
					label: previewToggleLabel.value,
					disabled: readonly.value,
					onSelect() {
						void requireWorkspace().change_is_preview(props.node.id, !props.isPreview)
					},
				}]
				: []),
			{
				label: 'Uncombine',
				disabled: props.loading || readonly.value,
				onSelect() {
					void requireWorkspace().uncombine_folder(props.node.id)
				},
			},
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

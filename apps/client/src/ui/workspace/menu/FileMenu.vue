<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import NodeMenuShell from './NodeMenuShell.vue'
import ColorPickerMenuSlot from './ColorPickerMenuSlot.vue'
import PresetColorsMenuSlot from './PresetColorsMenuSlot.vue'
import { useNodeMenu } from './useNodeMenu'
import { useColorSubmenu } from './useColorSubmenu'
import { get_preview_toggle_label, is_previewable_file } from '@/services/board/media'
import {
	is_line_shape,
	parse_line_meta,
	read_shape_color,
	type LinePlug,
} from '@/services/board/shapes'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { useSelectionMenu } from './useSelectionMenu'
import BulkRemoveDialog from './BulkRemoveDialog.vue'

const props = defineProps<{
	node: WorkspaceTreeNode
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

const isPreviewable = computed(() => is_previewable_file(props.node.name))

const previewToggleLabel = computed(() =>
	get_preview_toggle_label(props.node.name, props.isPreview ?? false),
)

const isShapePreview = computed(
	() => props.isPreview === true && props.node.name.endsWith('.svg'),
)

const requireWorkspace = useRequireWorkspace()
const workspace = useWorkspace()
const readonly = computed(() => workspace.value?.can_write === false)

const shapeFillColor = ref<string | undefined>()
const isLineShape = ref(false)
const startPlug = ref<LinePlug>('none')
const endPlug = ref<LinePlug>('none')

watch(
	() => [props.node.id, isShapePreview.value] as const,
	async ([id, isShape]) => {
		if (!isShape) {
			shapeFillColor.value = undefined
			isLineShape.value = false
			startPlug.value = 'none'
			endPlug.value = 'none'
			return
		}

		const content = await requireWorkspace().read_note_content(id)
		shapeFillColor.value = read_shape_color(content)
		isLineShape.value = is_line_shape(content)
		const meta = parse_line_meta(content)
		startPlug.value = meta?.startPlug ?? 'none'
		endPlug.value = meta?.endPlug ?? 'none'
	},
	{ immediate: true },
)

const colorSubmenuOptions = computed(() => {
	const child = openedChild.value
	if (!child || child.type !== 'file') return null

	if (isShapePreview.value) {
		return {
			label: isLineShape.value ? 'Color' : 'Fill',
			entityId: child.id,
			mode: 'shape_fill' as const,
			currentColor: shapeFillColor.value,
		}
	}

	if (child.is_preview) {
		return {
			label: 'Background',
			entityId: child.id,
			mode: 'background' as const,
			currentColor: child.background,
		}
	}

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

function linePlugItems(): DropdownMenuItem[] {
	if (!isShapePreview.value || !isLineShape.value) return []

	return [
		{
			label: 'Start arrow',
			type: 'checkbox' as const,
			checked: startPlug.value === 'arrow',
			disabled: readonly.value,
			onUpdateChecked(checked: boolean) {
				startPlug.value = checked ? 'arrow' : 'none'
				void requireWorkspace().change_line_plugs(props.node.id, {
					startPlug: startPlug.value,
					endPlug: endPlug.value,
				})
			},
			onSelect(e: Event) {
				e.preventDefault()
			},
		},
		{
			label: 'End arrow',
			type: 'checkbox' as const,
			checked: endPlug.value === 'arrow',
			disabled: readonly.value,
			onUpdateChecked(checked: boolean) {
				endPlug.value = checked ? 'arrow' : 'none'
				void requireWorkspace().change_line_plugs(props.node.id, {
					startPlug: startPlug.value,
					endPlug: endPlug.value,
				})
			},
			onSelect(e: Event) {
				e.preventDefault()
			},
		},
	]
}

const items = computed<DropdownMenuItem[][]>(() => {
	if (isMultiSelection.value) return selectionMenuItems.value

	const colorItem = colorMenuItem.value
	const plugItems = linePlugItems()

	const primary: DropdownMenuItem[] = [
		...(is_desktop
			? [{
				label: 'Open file',
				onSelect() {
					void requireWorkspace().open_file(props.node.id)
				},
			}]
			: []),
		...(props.showPreviewToggle && isPreviewable.value
			? [{
				label: previewToggleLabel.value,
				disabled: readonly.value,
				onSelect() {
					void requireWorkspace().change_is_preview(props.node.id, !props.isPreview)
				},
			}]
			: []),
		...(props.showPreviewToggle && colorItem ? [colorItem as DropdownMenuItem] : []),
		...plugItems,
	]

	return [
		...(primary.length > 0 ? [primary] : []),
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
		dropdown-width="min-w-50"
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

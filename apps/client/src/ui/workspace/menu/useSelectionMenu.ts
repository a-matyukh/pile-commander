import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import type BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import type { BulkRemoveItem } from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { clipboardIdsForMenu } from './clipboardIdsForMenu'
import { selectionCanSetSharedBackground } from './canHaveWidgetBackground'
import { useColorSubmenu } from './useColorSubmenu'

function toBulkItem(widget: FolderContainerWidgetChild): BulkRemoveItem {
	return {
		id: widget.id,
		name: widget.name,
		isFolder: widget.type === 'folder_container' || widget.type === 'folder_cover',
	}
}

/**
 * Cut / Copy / Duplicate / Remove for a node menu, plus shared Background when
 * every selected widget can have one. When the node is part of a multi-selection,
 * `isMultiSelection` is true and the host should show only `selectionMenuItems`
 * instead of the single-node actions.
 */
export function useSelectionMenu(node: MaybeRefOrGetter<WorkspaceTreeNode>) {
	const scope = useFolderContainerScope()
	const workspace = useWorkspace()
	const requireWorkspace = useRequireWorkspace()
	const dialogRef = ref<InstanceType<typeof BulkRemoveDialog> | null>(null)

	const paneChildren = computed(() => scope.container.value?.children ?? [])

	const selectedIds = computed(() => {
		const ws = workspace.value
		if (!ws) return [toValue(node).id]
		return clipboardIdsForMenu(toValue(node), ws, paneChildren.value)
	})

	const isMultiSelection = computed(() => selectedIds.value.length > 1)
	const readonly = computed(() => workspace.value?.can_write === false)

	const selectedChildren = computed(() => {
		const byId = new Map(paneChildren.value.map(child => [child.id, child]))
		return selectedIds.value
			.map(id => byId.get(id))
			.filter((child): child is FolderContainerWidgetChild => child != null)
	})

	const sharedBackground = computed(() => {
		const colors = selectedChildren.value.map(child => child.background)
		const first = colors[0]
		return colors.length > 0 && colors.every(color => color === first)
			? first
			: undefined
	})

	const {
		colorMenuItem,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		applyColor,
	} = useColorSubmenu(() => {
		if (!selectionCanSetSharedBackground(selectedChildren.value)) return null
		const firstId = selectedIds.value[0]
		if (!firstId) return null
		return {
			label: 'Background',
			entityId: firstId,
			mode: 'background' as const,
			currentColor: sharedBackground.value,
			async apply(color: string) {
				const ws = workspace.value
				if (!ws) return
				const value = color.trim() === '' ? 'none' : color
				for (const id of selectedIds.value) {
					await ws.change_background(id, value)
				}
			},
		}
	})

	function applyClipboard(action: 'cut' | 'copy' | 'duplicate') {
		const ws = requireWorkspace()
		const ids = clipboardIdsForMenu(toValue(node), ws, paneChildren.value)
		if (action === 'cut') ws.cut_entries(ids)
		else if (action === 'copy') ws.copy_entries(ids)
		else void ws.duplicate_entries(ids)
	}

	const clipboardItems = computed<DropdownMenuItem[]>(() => [
		{
			label: 'Cut',
			disabled: readonly.value,
			onSelect() {
				applyClipboard('cut')
			},
		},
		{
			label: 'Copy',
			onSelect() {
				applyClipboard('copy')
			},
		},
		{
			label: 'Duplicate',
			disabled: readonly.value,
			onSelect() {
				applyClipboard('duplicate')
			},
		},
	])

	function openBulkRemove() {
		const ws = workspace.value
		if (!ws?.can_write) return

		const byId = new Map(paneChildren.value.map(child => [child.id, child]))
		const items = selectedIds.value
			.map(id => byId.get(id))
			.filter((child): child is FolderContainerWidgetChild => child != null)
			.map(toBulkItem)
		if (items.length === 0) return
		dialogRef.value?.open(items)
	}

	async function onConfirm(payload: { ids: string[] }) {
		const ws = workspace.value
		if (!ws) return
		for (const id of payload.ids) {
			await ws.remove(id)
		}
		ws.exit_selection_mode()
	}

	const selectionMenuItems = computed<DropdownMenuItem[][]>(() => [
		...(colorMenuItem.value ? [[colorMenuItem.value]] : []),
		clipboardItems.value,
		[{
			label: 'Remove',
			disabled: readonly.value,
			onSelect: openBulkRemove,
		}],
	])

	return {
		isMultiSelection,
		clipboardItems,
		selectionMenuItems,
		dialogRef,
		onConfirm,
		pickerColor,
		onPickerPointerDown,
		commitPickerColor,
		applyColor,
	}
}

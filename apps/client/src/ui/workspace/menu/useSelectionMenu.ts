import { computed, ref, toValue, type MaybeRefOrGetter } from 'vue'
import type { DropdownMenuItem } from '@nuxt/ui'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import type { WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import type BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import type { BulkRemoveItem } from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import { useFolderContainerScope } from '@/ui/workspace/folder-container/useFolderContainerScope'
import { useRequireWorkspace, useWorkspace } from '@/ui/workspace/useWorkspace'
import { clipboardIdsForMenu } from './clipboardIdsForMenu'
import { t } from '@/i18n'
import { record_action } from '@/store/history'
import { selectionCanSetSharedBackground } from './canHaveWidgetBackground'
import { useColorSubmenu } from './useColorSubmenu'
import { ai_available } from '@/store/ai'
import { open_bulk_rename } from '@/store/aiBulkRename'
import { name_target_kind } from '@/services/ai/naming'
import { layer_order, type LayerStep } from '@/services/board/layerOrder'
import { open_summary } from '@/store/aiSummary'
import { open_ideas } from '@/store/aiIdeas'
import { open_sort } from '@/store/aiSort'
import { summary_entries, summary_position } from '@/services/ai/summarize'

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

	const canColor = computed(() => selectionCanSetSharedBackground(selectedChildren.value))

	const { applyColor } = useColorSubmenu(() => {
		if (!canColor.value) return null
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
				const ids = [...selectedIds.value]
				// The selection's new color is one undo
				await record_action(ws, { entry_id: ids[0] }, t('undo.color'), async (tx) => {
					for (const id of ids) {
						await ws.change_background(id, value, { tx })
					}
				})
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
		await ws.remove_entries(payload.ids)
		ws.exit_selection_mode()
	}

	/** Selected notes, folders and images: what a name can be suggested for. */
	const nameableEntries = computed(() => selectedChildren.value
		.map(child => ({
			id: child.id,
			name: child.name,
			type: (child.type === 'folder_container' || child.type === 'folder_cover' ? 'folder' : 'file') as 'file' | 'folder',
		}))
		.filter(entry => name_target_kind(entry) !== null))

	function openBulkRename() {
		const ws = workspace.value
		const folder_id = scope.container.value?.id
		if (!ws || !folder_id) return
		open_bulk_rename(ws, folder_id, nameableEntries.value)
	}

	function openSummary() {
		const ws = workspace.value
		const container = scope.container.value
		if (!ws || !container) return
		const selected = new Set(selectedIds.value)
		// container.children is board order; selectedChildren follows click order
		const widgets = container.children.filter(child => selected.has(child.id))
		open_summary({
			workspace: ws,
			folder_id: container.id,
			board_name: container.name,
			entries: summary_entries(widgets),
			position: summary_position(widgets),
		})
	}

	/** Ideas from what is selected, placed to its right. */
	function openIdeas() {
		const ws = workspace.value
		const container = scope.container.value
		if (!ws || !container) return
		const selected = new Set(selectedIds.value)
		const widgets = container.children.filter(child => selected.has(child.id))
		open_ideas({
			workspace: ws,
			folder_id: container.id,
			board_name: container.name,
			entries: summary_entries(widgets),
			anchor: summary_position(widgets),
		})
	}

	/** What is selected, sorted into folders inside this one. */
	function openSort() {
		const ws = workspace.value
		const container = scope.container.value
		if (!ws || !container) return
		const selected = new Set(selectedIds.value)
		const widgets = container.children.filter(child => selected.has(child.id))
		open_sort({ workspace: ws, folder_id: container.id, board_name: container.name, entries: summary_entries(widgets) })
	}

	const spatial = computed(() => {
		const view = scope.container.value?.view
		return view === 'board' || view === 'canvas'
	})

	function apply_layer(step: LayerStep) {
		const folder_id = scope.folderId.value
		const order = paneChildren.value.map(child => child.id)
		const next = layer_order(order, selectedIds.value, step)
		if (!next || !folder_id) return
		void requireWorkspace().reorder_children(folder_id, next)
	}

	const layerItems = computed<DropdownMenuItem[]>(() => {
		if (!spatial.value) return []
		const order = paneChildren.value.map(child => child.id)
		const moving = selectedIds.value
		const stuck = (step: LayerStep) => layer_order(order, moving, step) === null
		return [{
			label: 'Layer',
			disabled: readonly.value,
			children: [
				{
					label: 'Bring to front',
					kbds: [']'],
					disabled: readonly.value || stuck('front'),
					onSelect() { apply_layer('front') },
				},
				{
					label: 'Bring forward',
					kbds: ['meta', ']'],
					disabled: readonly.value || stuck('forward'),
					onSelect() { apply_layer('forward') },
				},
				{
					label: 'Send backward',
					kbds: ['meta', '['],
					disabled: readonly.value || stuck('backward'),
					onSelect() { apply_layer('backward') },
				},
				{
					label: 'Send to back',
					kbds: ['['],
					disabled: readonly.value || stuck('back'),
					onSelect() { apply_layer('back') },
				},
			],
		}]
	})

	const aiItems = computed<DropdownMenuItem[]>(() => {
		if (!ai_available(workspace.value)) return []
		return [
			...(nameableEntries.value.length > 0 ? [{ label: 'Suggest names', onSelect: openBulkRename }] : []),
			{ label: 'Summarize', onSelect: openSummary },
			{ label: 'Generate ideas', onSelect: openIdeas },
			...(selectedChildren.value.length > 1 ? [{ label: 'Sort into folders', onSelect: openSort }] : []),
		]
	})

	const selectionMenuItems = computed<DropdownMenuItem[][]>(() => [
		...(layerItems.value.length ? [layerItems.value] : []),
		...(canColor.value ? [[{
			label: 'Background',
			disabled: readonly.value,
			children: [{ slot: 'selection-color' as const, raw: true }],
		}]] : []),
		...(aiItems.value.length ? [aiItems.value] : []),
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
		layerItems,
		selectionMenuItems,
		sharedBackground,
		dialogRef,
		onConfirm,
		applyColor,
	}
}

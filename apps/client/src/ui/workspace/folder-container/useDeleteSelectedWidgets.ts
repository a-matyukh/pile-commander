import {
	computed,
	onMounted,
	onUnmounted,
	ref,
	toValue,
	type MaybeRefOrGetter,
	type Ref,
} from 'vue'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import type BulkRemoveDialog from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import type { BulkRemoveItem } from '@/ui/workspace/menu/BulkRemoveDialog.vue'
import type RemoveDialog from '@/ui/workspace/menu/RemoveDialog.vue'
import { useRequireWorkspace } from '@/ui/workspace/useWorkspace'
import { menuNodeFor } from './widgets/useMenuNode'

type UseDeleteSelectedWidgetsOptions = {
	children: MaybeRefOrGetter<FolderContainerWidgetChild[]>
	editingNoteId: Ref<string | null>
	/** When false, keyboard handler is inactive (e.g. canvas ink-select owns Backspace). */
	enabled?: MaybeRefOrGetter<boolean>
}

function isTypingTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false
	if (target.isContentEditable) return true
	const tag = target.tagName
	return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

function toBulkItem(widget: FolderContainerWidgetChild): BulkRemoveItem {
	return {
		id: widget.id,
		name: widget.name,
		isFolder: widget.type === 'folder_container' || widget.type === 'folder_cover',
	}
}

export function useDeleteSelectedWidgets(options: UseDeleteSelectedWidgetsOptions) {
	const dialogRef = ref<InstanceType<typeof BulkRemoveDialog> | null>(null)
	const removeDialogRef = ref<InstanceType<typeof RemoveDialog> | null>(null)
	const ws = useRequireWorkspace()()

	function selectedChildren(): FolderContainerWidgetChild[] {
		const childIds = new Set(toValue(options.children).map(child => child.id))
		const byId = new Map(toValue(options.children).map(child => [child.id, child]))
		return ws.selection
			.filter(id => childIds.has(id))
			.map(id => byId.get(id))
			.filter((child): child is FolderContainerWidgetChild => child != null)
	}

	const selectedCount = computed(() => {
		const childIds = new Set(toValue(options.children).map(child => child.id))
		return ws.selection.filter(id => childIds.has(id)).length
	})

	/** Remove control for multi-select (shown on the folder actions panel). */
	const showBulkRemoveButton = computed(() => selectedCount.value >= 2 && ws.can_write)

	function openConfirm() {
		if (toValue(options.enabled) === false) return
		if (!ws.can_write) return
		if (options.editingNoteId.value) return

		const selected = selectedChildren()
		if (selected.length === 0) return

		// One item: the same dialog as the context menu's Remove. Several: the bulk ask.
		if (selected.length === 1) {
			const node = menuNodeFor(selected[0]!)
			removeDialogRef.value?.open(node.name, node.id, node.type)
			return
		}

		dialogRef.value?.open(selected.map(toBulkItem))
	}

	async function onConfirm(payload: { ids: string[] }) {
		await ws.remove_entries(payload.ids)
		ws.exit_selection_mode()
	}

	function onConfirmOne(payload: { id: string }) {
		return onConfirm({ ids: [payload.id] })
	}

	function onKeyDown(event: KeyboardEvent) {
		if (event.key !== 'Backspace' && event.key !== 'Delete') return
		if (event.defaultPrevented) return
		if (isTypingTarget(event.target)) return
		if (toValue(options.enabled) === false) return
		if (!ws.can_write) return
		if (options.editingNoteId.value) return
		if (selectedChildren().length === 0) return

		event.preventDefault()
		openConfirm()
	}

	onMounted(() => {
		window.addEventListener('keydown', onKeyDown)
	})

	onUnmounted(() => {
		window.removeEventListener('keydown', onKeyDown)
	})

	return {
		dialogRef,
		removeDialogRef,
		onConfirm,
		onConfirmOne,
		openConfirm,
		selectedCount,
		showBulkRemoveButton,
	}
}

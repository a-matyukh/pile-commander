import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { useWorkspace } from '@/ui/workspace/useWorkspace'

function ordersMatch(a: string[], b: string[]): boolean {
	return a.length === b.length && a.every((id, i) => id === b[i])
}

/**
 * Fingerprint for syncing the local Sortable list from the store.
 * Must include fields that change widget role/rendering without reordering
 * (e.g. is_preview → note widget), otherwise Stack keeps a stale copy.
 */
function childrenSyncKey(children: FolderContainerWidgetChild[] | undefined): string {
	return children
		?.map(c => [
			c.id,
			c.type,
			c.name,
			String(c.is_preview ?? false),
			c.background ?? '',
		].join('\0'))
		.join('\n') ?? ''
}

/**
 * Sortable/vuedraggable list reorder for Stack.
 *
 * Uses a stable mutable `children` ref (like the workspace tree `:list` pattern).
 * Do not reset the list on drag start — vuedraggable emits `start` on nextTick,
 * after Sortable has already moved DOM; replacing the array then snaps items back.
 */
export function useDraggableReorder(
	folderId: ComputedRef<string>,
	container: ComputedRef<FolderContainerWidget | null>,
	group: MaybeRefOrGetter<{ name: string }>,
) {
	const children = ref<FolderContainerWidgetChild[]>([])
	const is_dragging = ref(false)
	const is_persisting = ref(false)
	const workspace = useWorkspace()

	function getStoreChildren(): FolderContainerWidgetChild[] {
		try {
			return container.value?.children ?? []
		} catch {
			return []
		}
	}

	function sync_children_from_store() {
		children.value = [...getStoreChildren()]
	}

	watch(
		() => childrenSyncKey(container.value?.children),
		() => {
			if (is_dragging.value || is_persisting.value) return
			sync_children_from_store()
		},
		{ immediate: true },
	)

	const dragGroup = computed(() => toValue(group))

	function on_start() {
		is_dragging.value = true
	}

	async function on_end() {
		if (!is_dragging.value) return

		const orderedIds = children.value.map(c => c.id)
		const storeIds = getStoreChildren().map(c => c.id)
		const changed = !ordersMatch(orderedIds, storeIds)

		if (!changed || !workspace.value) {
			is_dragging.value = false
			if (!changed) return
			sync_children_from_store()
			return
		}

		is_persisting.value = true
		is_dragging.value = false
		try {
			await workspace.value.reorder_children(folderId.value, orderedIds)
		} finally {
			is_persisting.value = false
			sync_children_from_store()
		}
	}

	return {
		children,
		is_dragging,
		is_persisting,
		dragGroup,
		sync_children_from_store,
		on_start,
		on_end,
	}
}

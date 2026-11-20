import { computed, ref, toValue, watch, type ComputedRef, type MaybeRefOrGetter } from 'vue'
import type { FolderContainerWidget, FolderContainerWidgetChild } from '@/domain/Widget'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { t } from '@/i18n'
import { entries_label, record_action } from '@/store/history'
import { parent_folder_id_from_node_id } from '@/services/workspace/paths'
import type { DragChangeEvent, DragEndEvent } from '../widgets/DraggableWidgetList.vue'

/**
 * Bumped after a card moved between stacks, done or not: every stack reads
 * its list from the store again, so the one the card left gets it back if
 * the move failed (Sortable already took it out of that list's array).
 */
const stacks_resync = ref(0)

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
 * Sortable/vuedraggable list reorder for Stack, and moves between stacks:
 * every stack of a workspace shares one Sortable group, so a card can be
 * dragged from one folder preview into another (a kanban's columns). The
 * list it lands in moves the file there and keeps the order it was dropped
 * in; the list it left only lets go.
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

	watch(stacks_resync, () => {
		if (is_dragging.value || is_persisting.value) return
		sync_children_from_store()
	})

	const dragGroup = computed(() => toValue(group))

	function on_start() {
		is_dragging.value = true
	}

	async function on_end(event?: DragEndEvent) {
		if (!is_dragging.value) return

		// The card left for another stack: that stack moves the file
		if (event && event.from !== event.to) {
			is_dragging.value = false
			return
		}

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
		const ws = workspace.value
		const folder_id = folderId.value
		try {
			await record_action(ws, { folder_id }, t('undo.layers'), tx => ws.reorder_children(folder_id, orderedIds, { tx }))
		} finally {
			is_persisting.value = false
			sync_children_from_store()
		}
	}

	/** A card from another stack landed here: move its file into this folder, at that place */
	async function on_change(event: DragChangeEvent) {
		const added = event.added
		if (!added) return
		const ws = workspace.value
		const folder_id = folderId.value
		if (!ws || ws.can_write === false) {
			sync_children_from_store()
			return
		}
		const id = added.element.id
		const source_id = parent_folder_id_from_node_id(id, ws.id)
		is_persisting.value = true
		try {
			// A preview's files are not in the tree until the folder is shown there
			await ws.show_folder_children(source_id)
			const moved = await record_action(
				ws,
				{ folder_id },
				entries_label(ws, [id], 'undo.move_entry', 'undo.move_entries'),
				async tx => {
					const new_id = await ws.move(id, folder_id, added.newIndex, undefined, undefined, { tx })
					if (!new_id) return false
					const ordered = children.value.map(child => child.id === id ? new_id : child.id)
					await ws.reorder_children(folder_id, ordered, { tx })
					return true
				},
				{ notice: entries_label(ws, [id], 'undo.moved', 'undo.moved_many') },
			)
			if (!moved) sync_children_from_store()
		} finally {
			is_persisting.value = false
			sync_children_from_store()
			stacks_resync.value++
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
		on_change,
	}
}

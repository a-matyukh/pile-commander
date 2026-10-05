import { ref, inject, provide, type InjectionKey } from 'vue'

export type TreeDragState = {
	is_tree_dragging: ReturnType<typeof ref<boolean>>
	pending_removals: Map<string, { parent_id: string; old_index: number }>
	reset_tree_drag_state: () => void
}

const treeDragStateKey: InjectionKey<TreeDragState> = Symbol('treeDragState')

export function provideTreeDragState(): TreeDragState {
	const is_tree_dragging = ref(false)
	const pending_removals = new Map<string, { parent_id: string; old_index: number }>()

	function reset_tree_drag_state() {
		is_tree_dragging.value = false
		pending_removals.clear()
	}

	const state: TreeDragState = { is_tree_dragging, pending_removals, reset_tree_drag_state }
	provide(treeDragStateKey, state)
	return state
}

export function useTreeDragState(): TreeDragState {
	const injected = inject(treeDragStateKey, null)
	if (!injected) {
		throw new Error('useTreeDragState() requires provideTreeDragState() in a parent')
	}
	return injected
}

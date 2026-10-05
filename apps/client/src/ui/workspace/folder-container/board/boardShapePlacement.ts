import { ref, inject, provide, type Ref, type InjectionKey } from 'vue'
import type { ShapeTemplate } from '@/domain/shapes'

export type BoardPlacementState = {
	boardPlacementTemplate: Ref<ShapeTemplate | null>
	clearBoardPlacement: () => void
}

const boardPlacementKey: InjectionKey<BoardPlacementState> = Symbol('boardPlacement')

export function provideBoardPlacement(): BoardPlacementState {
	const boardPlacementTemplate = ref<ShapeTemplate | null>(null)

	function clearBoardPlacement() {
		boardPlacementTemplate.value = null
	}

	const state: BoardPlacementState = { boardPlacementTemplate, clearBoardPlacement }
	provide(boardPlacementKey, state)
	return state
}

export function useBoardPlacement(): BoardPlacementState {
	const injected = inject(boardPlacementKey, null)
	if (!injected) {
		throw new Error('useBoardPlacement() requires provideBoardPlacement() in a parent')
	}
	return injected
}

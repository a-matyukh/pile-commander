import { computed } from 'vue'
import type { BoardSnapSettings } from '@/services/board/layout'
import { DEFAULT_GRID_SIZE } from '@/services/board/layout'
import { useFolderContainerScope } from './useFolderContainerScope'

export function useBoardSnapSettings() {
	const { container } = useFolderContainerScope()

	return computed<BoardSnapSettings>(() => ({
		snap_to_grid: container.value?.snap_to_grid ?? false,
		grid_size: container.value?.grid_size ?? DEFAULT_GRID_SIZE,
	}))
}

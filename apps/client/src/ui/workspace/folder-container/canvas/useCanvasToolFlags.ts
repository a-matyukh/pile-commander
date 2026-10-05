import { computed, type ComputedRef, type Ref } from 'vue'
import type { BoardSnapSettings } from '@/services/board/layout'
import type { EditorTool } from './drawing/types'

/** Vue Flow interaction flags derived from the active editor tool. */
export function useCanvasToolFlags(
	tool: Ref<EditorTool>,
	boardSnapSettings: ComputedRef<BoardSnapSettings>,
) {
	const isSelectTool = computed(() => tool.value === 'select')
	const isLassoTool = computed(() => tool.value === 'lasso')
	const isHandTool = computed(() => tool.value === 'hand')
	const isConnectTool = computed(() => tool.value === 'connect')
	const isDisconnectTool = computed(() => tool.value === 'disconnect')
	const isConnectMode = computed(() => isConnectTool.value || isDisconnectTool.value)
	const isDrawTool = computed(() => tool.value === 'pen' || tool.value === 'eraser')

	const preventScrolling = computed(
		() =>
			tool.value === 'pen' ||
			tool.value === 'eraser' ||
			tool.value === 'lasso' ||
			tool.value === 'hand' ||
			isConnectMode.value,
	)

	const pinchEnabled = computed(
		() =>
			tool.value === 'pen' ||
			tool.value === 'eraser' ||
			tool.value === 'hand' ||
			isConnectMode.value,
	)

	const panOnDrag = computed<boolean | number[]>(() => {
		if (isHandTool.value) return true
		// Middle mouse only. Vue Flow preventDefaults `contextmenu` when 2 (right
		// button) is listed, which would hide the folder context menu.
		if (isSelectTool.value || isConnectMode.value) {
			return [1]
		}
		return false
	})

	const snapToGrid = computed(() => boardSnapSettings.value.snap_to_grid && !isDrawTool.value)
	const snapGrid = computed(() => {
		const size = boardSnapSettings.value.grid_size
		return [size, size] as [number, number]
	})

	return {
		isSelectTool,
		isLassoTool,
		isHandTool,
		isConnectTool,
		isDisconnectTool,
		isConnectMode,
		isDrawTool,
		preventScrolling,
		pinchEnabled,
		panOnDrag,
		snapToGrid,
		snapGrid,
	}
}

export type CanvasToolFlags = ReturnType<typeof useCanvasToolFlags>

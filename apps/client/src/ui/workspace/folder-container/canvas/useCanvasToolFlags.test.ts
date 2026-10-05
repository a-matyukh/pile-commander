import { describe, expect, test } from 'vitest'
import { computed, ref } from 'vue'
import type { BoardSnapSettings } from '@/services/board/layout'
import type { EditorTool } from './drawing/types'
import { useCanvasToolFlags } from './useCanvasToolFlags'

const snap = computed<BoardSnapSettings>(() => ({
	snap_to_grid: false,
	grid_size: 20,
}))

function flags(tool: EditorTool) {
	return useCanvasToolFlags(ref(tool), snap)
}

describe('useCanvasToolFlags panOnDrag', () => {
	test('Hand pans with the primary button', () => {
		expect(flags('hand').panOnDrag.value).toBe(true)
	})

	test('Select and connect pan with middle mouse, not right-click', () => {
		expect(flags('select').panOnDrag.value).toEqual([1])
		expect(flags('connect').panOnDrag.value).toEqual([1])
		expect(flags('disconnect').panOnDrag.value).toEqual([1])
	})

	test('drawing tools do not pan the pane', () => {
		expect(flags('pen').panOnDrag.value).toBe(false)
		expect(flags('eraser').panOnDrag.value).toBe(false)
		expect(flags('lasso').panOnDrag.value).toBe(false)
	})
})

import { describe, expect, test } from 'vitest'
import { nextCanvasFlowId } from './canvasFlowId'

describe('nextCanvasFlowId', () => {
	test('every canvas on screen gets its own id', () => {
		const ids = Array.from({ length: 50 }, () => nextCanvasFlowId())
		expect(new Set(ids).size).toBe(50)
	})

	test('the id holds inside an unquoted CSS url(), whatever the folder is called', () => {
		// Vue Flow writes fill="url(#pattern-<id>-grid-dots)": a parenthesis, a quote or a space ends that url
		for (let i = 0; i < 20; i++) {
			expect(nextCanvasFlowId()).toMatch(/^canvas-\d+$/)
		}
	})
})

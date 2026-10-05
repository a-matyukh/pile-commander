import { describe, expect, test } from 'vitest'
import { resolveIsCanvasWidgetLayout } from './resolveIsCanvasWidgetLayout'

describe('resolveIsCanvasWidgetLayout', () => {
	test('board layout is never canvas widget layout', () => {
		expect(resolveIsCanvasWidgetLayout('board', false, 'canvas')).toBe(false)
		expect(resolveIsCanvasWidgetLayout('board', true, 'board')).toBe(false)
	})

	test('top-level canvas folder uses canvas widget layout', () => {
		expect(resolveIsCanvasWidgetLayout('canvas', false, 'canvas')).toBe(true)
	})

	test('embedded board preview inside canvas keeps board widget layout', () => {
		expect(resolveIsCanvasWidgetLayout('canvas', true, 'board')).toBe(false)
	})

	test('embedded canvas preview inside canvas uses canvas widget layout', () => {
		expect(resolveIsCanvasWidgetLayout('canvas', true, 'canvas')).toBe(true)
	})
})

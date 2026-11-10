import { describe, expect, test } from 'vitest'
import { DEFAULT_CANVAS_PEN_PREFS, mergeCanvasPenPrefs } from './canvasPenPrefs'

describe('mergeCanvasPenPrefs', () => {
	test('returns defaults for missing or invalid payloads', () => {
		expect(mergeCanvasPenPrefs(undefined)).toEqual(DEFAULT_CANVAS_PEN_PREFS)
		expect(mergeCanvasPenPrefs(null)).toEqual(DEFAULT_CANVAS_PEN_PREFS)
		expect(mergeCanvasPenPrefs('red')).toEqual(DEFAULT_CANVAS_PEN_PREFS)
		expect(mergeCanvasPenPrefs([])).toEqual(DEFAULT_CANVAS_PEN_PREFS)
	})

	test('keeps a saved color and width', () => {
		expect(mergeCanvasPenPrefs({ color: '#EF4444', width: 8 })).toEqual({ color: '#EF4444', width: 8 })
	})

	test('fills a missing field from defaults', () => {
		expect(mergeCanvasPenPrefs({ color: '#22c55e' })).toEqual({ color: '#22c55e', width: 4 })
		expect(mergeCanvasPenPrefs({ width: 16 })).toEqual({ color: '#111827', width: 16 })
	})

	test('drops a color that is not a hex color', () => {
		expect(mergeCanvasPenPrefs({ color: 'url(javascript:1)', width: 8 })).toEqual({ color: '#111827', width: 8 })
		expect(mergeCanvasPenPrefs({ color: '#fff' }).color).toBe('#111827')
		expect(mergeCanvasPenPrefs({ color: 7 }).color).toBe('#111827')
	})

	test('keeps the width a whole number within the pen range', () => {
		expect(mergeCanvasPenPrefs({ width: 0 }).width).toBe(1)
		expect(mergeCanvasPenPrefs({ width: 500 }).width).toBe(24)
		expect(mergeCanvasPenPrefs({ width: 7.6 }).width).toBe(8)
		expect(mergeCanvasPenPrefs({ width: Number.NaN }).width).toBe(4)
		expect(mergeCanvasPenPrefs({ width: '8' }).width).toBe(4)
	})
})

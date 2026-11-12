import { describe, expect, test } from 'vitest'
import {
	DEFAULT_CANVAS_TOOLBAR_PREFS,
	isCanvasToolAllowed,
	mergeCanvasToolbarPrefs,
} from './useCanvasToolbarPrefs'

describe('mergeCanvasToolbarPrefs', () => {
	test('returns defaults for missing or invalid payloads', () => {
		expect(mergeCanvasToolbarPrefs(undefined)).toEqual(DEFAULT_CANVAS_TOOLBAR_PREFS)
		expect(mergeCanvasToolbarPrefs(null)).toEqual(DEFAULT_CANVAS_TOOLBAR_PREFS)
		expect(mergeCanvasToolbarPrefs('nope')).toEqual(DEFAULT_CANVAS_TOOLBAR_PREFS)
		expect(mergeCanvasToolbarPrefs([])).toEqual(DEFAULT_CANVAS_TOOLBAR_PREFS)
	})

	test('keeps a valid hidden flag', () => {
		expect(mergeCanvasToolbarPrefs({ hidden: true })).toEqual({ hidden: true })
	})

	test('settings saved with the old toolbar keep only whether the panel is hidden', () => {
		expect(mergeCanvasToolbarPrefs({ hidden: false, classic: true, compactView: true, side: 'bottom' }))
			.toEqual({ hidden: false })
	})

	test('drops invalid field types', () => {
		expect(mergeCanvasToolbarPrefs({ hidden: 'yes' })).toEqual(DEFAULT_CANVAS_TOOLBAR_PREFS)
	})
})

describe('isCanvasToolAllowed', () => {
	test('allows every tool while the toolbar is visible', () => {
		expect(isCanvasToolAllowed('pen', false)).toBe(true)
		expect(isCanvasToolAllowed('hand', false)).toBe(true)
	})

	test('only allows Hand while the toolbar is hidden', () => {
		expect(isCanvasToolAllowed('hand', true)).toBe(true)
		expect(isCanvasToolAllowed('pen', true)).toBe(false)
		expect(isCanvasToolAllowed('select', true)).toBe(false)
	})
})

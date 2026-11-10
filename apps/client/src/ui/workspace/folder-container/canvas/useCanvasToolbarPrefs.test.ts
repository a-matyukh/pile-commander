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

	test('keeps valid fields and fills the rest from defaults', () => {
		expect(mergeCanvasToolbarPrefs({ hidden: true })).toEqual({
			hidden: true,
			classic: false,
			compactView: false,
			side: 'top',
		})
		expect(mergeCanvasToolbarPrefs({
			hidden: true,
			classic: true,
			compactView: true,
			side: 'bottom',
		})).toEqual({
			hidden: true,
			classic: true,
			compactView: true,
			side: 'bottom',
		})
	})

	test('settings saved before the bottom panel open with it, not with the classic toolbar', () => {
		expect(mergeCanvasToolbarPrefs({ hidden: false, compactView: true, side: 'bottom' }).classic).toBe(false)
	})

	test('drops invalid field types', () => {
		expect(mergeCanvasToolbarPrefs({
			hidden: 'yes',
			classic: 1,
			compactView: 1,
			side: 'left',
		})).toEqual(DEFAULT_CANVAS_TOOLBAR_PREFS)
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

import { describe, expect, test } from 'vitest'
import { CANVAS_TOOL_HOTKEYS, toolFromHotkey } from './useCanvasToolShortcuts'

describe('canvas tool hotkeys', () => {
	test('maps each toolbar tool to a letter', () => {
		expect(toolFromHotkey('h')).toBe('hand')
		expect(toolFromHotkey('S')).toBe('select')
		expect(toolFromHotkey('l')).toBe('lasso')
		expect(toolFromHotkey('c')).toBe('connect')
		expect(toolFromHotkey('d')).toBe('disconnect')
		expect(toolFromHotkey('p')).toBe('pen')
		expect(toolFromHotkey('e')).toBe('eraser')
		expect(toolFromHotkey('x')).toBeUndefined()
	})

	test('hotkey labels match the keymap', () => {
		expect(CANVAS_TOOL_HOTKEYS.select).toBe('S')
		expect(CANVAS_TOOL_HOTKEYS.lasso).toBe('L')
		expect(CANVAS_TOOL_HOTKEYS.disconnect).toBe('D')
	})
})

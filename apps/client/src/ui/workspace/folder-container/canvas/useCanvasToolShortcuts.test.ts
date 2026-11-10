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

	test('a Cyrillic layout goes by the place of the key', () => {
		expect(toolFromHotkey('р', 'KeyH')).toBe('hand')
		expect(toolFromHotkey('ы', 'KeyS')).toBe('select')
		expect(toolFromHotkey('Д', 'KeyL')).toBe('lasso')
		expect(toolFromHotkey('з', 'KeyP')).toBe('pen')
		expect(toolFromHotkey('ч', 'KeyX')).toBeUndefined()
	})

	test('a Latin layout goes by the letter it types, wherever the key is', () => {
		// Dvorak types "d" with the key QWERTY has "h" on
		expect(toolFromHotkey('d', 'KeyH')).toBe('disconnect')
		expect(toolFromHotkey('h', 'KeyJ')).toBe('hand')
	})

	test('a key that is not a letter is no tool', () => {
		expect(toolFromHotkey('1', 'Digit1')).toBeUndefined()
		expect(toolFromHotkey(' ', 'Space')).toBeUndefined()
		expect(toolFromHotkey('Enter', 'Enter')).toBeUndefined()
	})

	test('hotkey labels match the keymap', () => {
		expect(CANVAS_TOOL_HOTKEYS.select).toBe('S')
		expect(CANVAS_TOOL_HOTKEYS.lasso).toBe('L')
		expect(CANVAS_TOOL_HOTKEYS.disconnect).toBe('D')
	})
})

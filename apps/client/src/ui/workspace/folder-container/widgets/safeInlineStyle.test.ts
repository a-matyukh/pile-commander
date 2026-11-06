import { describe, expect, test } from 'vitest'
import { safeInlineStyle } from './safeInlineStyle'

describe('safeInlineStyle', () => {
	test('keeps text colors in every plain form', () => {
		expect(safeInlineStyle('color: #c00')).toBe('color: #c00')
		expect(safeInlineStyle('color:#C0392B80')).toBe('color: #C0392B80')
		expect(safeInlineStyle('background-color: rgb(250 199 117 / 55%)')).toBe('background-color: rgb(250 199 117 / 55%)')
		expect(safeInlineStyle('color: hsla(210, 50%, 40%, 0.8)')).toBe('color: hsla(210, 50%, 40%, 0.8)')
		expect(safeInlineStyle('color: rebeccapurple')).toBe('color: rebeccapurple')
		expect(safeInlineStyle('background: yellow')).toBe('background: yellow')
	})

	test('keeps alignment, weight, slant and decoration', () => {
		expect(safeInlineStyle('text-align: center; font-weight: 700; font-style: italic; text-decoration: underline line-through'))
			.toBe('text-align: center; font-weight: 700; font-style: italic; text-decoration: underline line-through')
	})

	test('drops layout, so a note cannot cover or move the app', () => {
		expect(safeInlineStyle('position: fixed; inset: 0; z-index: 9999; width: 100vw; height: 100vh; display: block')).toBe('')
		expect(safeInlineStyle('color: red; position: fixed; top: 0')).toBe('color: red')
	})

	test('drops images, expressions, escapes and !important', () => {
		expect(safeInlineStyle('background: url(https://evil.example/b.png)')).toBe('')
		expect(safeInlineStyle('background: red url(https://evil.example/b.png)')).toBe('')
		expect(safeInlineStyle('background-color: rgb(url(x))')).toBe('')
		expect(safeInlineStyle('color: expression(alert(1))')).toBe('')
		expect(safeInlineStyle('color: \\72 ed')).toBe('')
		expect(safeInlineStyle('color: red !important')).toBe('')
	})

	test('reads property names in any case and ignores junk', () => {
		expect(safeInlineStyle('COLOR: red')).toBe('color: red')
		expect(safeInlineStyle('')).toBe('')
		expect(safeInlineStyle(';;color;:red; constructor: x; __proto__: y')).toBe('')
	})
})

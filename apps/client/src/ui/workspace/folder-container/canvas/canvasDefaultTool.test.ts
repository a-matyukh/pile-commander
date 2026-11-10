import { describe, expect, test } from 'vitest'
import { default_canvas_tool } from './canvasDefaultTool'

const desk = { can_write: true, hidden: false, embedded: false, coarse: false }

describe('default_canvas_tool', () => {
	test('a canvas opens with Select', () => {
		expect(default_canvas_tool(desk)).toBe('select')
	})

	test('a touch screen opens with Hand', () => {
		expect(default_canvas_tool({ ...desk, coarse: true })).toBe('hand')
	})

	test('a viewer opens with Hand', () => {
		expect(default_canvas_tool({ ...desk, can_write: false })).toBe('hand')
	})

	test('a hidden toolbar is Hand', () => {
		expect(default_canvas_tool({ ...desk, hidden: true })).toBe('hand')
	})

	test('a folder preview opens with Hand', () => {
		expect(default_canvas_tool({ ...desk, embedded: true })).toBe('hand')
	})
})

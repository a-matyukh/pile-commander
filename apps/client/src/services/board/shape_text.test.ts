import { describe, expect, test } from 'vitest'
import { has_text_area_switch, shape_text_color, shape_text_kind } from './shape_text'
import { shape_template_svg } from './shapes'

describe('shape text', () => {
	test('reads the shape of the templates; anything else is a box', () => {
		expect(shape_text_kind(shape_template_svg('rect'))).toBe('rect')
		expect(shape_text_kind(shape_template_svg('ellipse'))).toBe('ellipse')
		expect(shape_text_kind(shape_template_svg('triangle'))).toBe('triangle')
		expect(shape_text_kind(shape_template_svg('diamond'))).toBe('diamond')
		expect(shape_text_kind('<svg><path d="M0 0"/></svg>')).toBe('rect')
		expect(has_text_area_switch('rect')).toBe(false)
		expect(has_text_area_switch('triangle')).toBe(true)
	})

	test('white text on a dark fill, dark on a light one', () => {
		expect(shape_text_color('#6366f1')).toBe('#ffffff')
		expect(shape_text_color('#4338ca')).toBe('#ffffff')
		expect(shape_text_color('#fde68a')).toBe('#1f1f1e')
		expect(shape_text_color('#fff')).toBe('#1f1f1e')
		expect(shape_text_color(undefined)).toBe('#1f1f1e')
	})
})

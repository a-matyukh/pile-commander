import { describe, expect, test } from 'vitest'
import { image_caption_in_view, image_text_from_stored } from './imageText'

describe('image_text_from_stored', () => {
	test('keeps a trimmed string and drops blanks', () => {
		expect(image_text_from_stored('  Sunset  ')).toBe('Sunset')
		expect(image_text_from_stored('   ')).toBeUndefined()
		expect(image_text_from_stored('')).toBeUndefined()
	})

	test('shows numbers and booleans that the xattr parser produced', () => {
		expect(image_text_from_stored(2024)).toBe('2024')
		expect(image_text_from_stored(true)).toBe('true')
		expect(image_text_from_stored(false)).toBe('false')
	})

	test('ignores objects and arrays', () => {
		expect(image_text_from_stored({ a: 1 })).toBeUndefined()
		expect(image_text_from_stored([1])).toBeUndefined()
		expect(image_text_from_stored(null)).toBeUndefined()
	})
})

describe('image_caption_in_view', () => {
	test('is on for the large-image folder views', () => {
		expect(image_caption_in_view('board')).toBe(true)
		expect(image_caption_in_view('canvas')).toBe(true)
		expect(image_caption_in_view('dashboard')).toBe(true)
		expect(image_caption_in_view('masonry')).toBe(true)
		expect(image_caption_in_view('slides')).toBe(true)
	})

	test('is off for list, gallery and stack', () => {
		expect(image_caption_in_view('list')).toBe(false)
		expect(image_caption_in_view('grid')).toBe(false)
		expect(image_caption_in_view('stack')).toBe(false)
		expect(image_caption_in_view(undefined)).toBe(false)
	})
})

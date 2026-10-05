import { describe, expect, test } from 'vitest'
import { preview_element, show_play_badge } from './previewElement'

describe('preview_element', () => {
	test('a video poster renders as an image with a play badge', () => {
		expect(preview_element('video', 'poster')).toBe('img')
		expect(show_play_badge('video', 'poster')).toBe(true)
	})

	test('the original video stays a player', () => {
		expect(preview_element('video', 'original')).toBe('video')
		expect(show_play_badge('video', 'original')).toBe(false)
	})

	test('images render as images whatever the variant, without a badge', () => {
		expect(preview_element('image', 'original')).toBe('img')
		expect(preview_element('image', 'thumb')).toBe('img')
		expect(show_play_badge('image', 'thumb')).toBe(false)
	})

	test('audio has no preview and stays a player', () => {
		expect(preview_element('audio', 'original')).toBe('audio')
		expect(show_play_badge('audio', 'original')).toBe(false)
	})
})

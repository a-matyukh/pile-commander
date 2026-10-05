import { describe, expect, it } from 'vitest'
import { backgroundStyle, isEmbeddedDataUrl, isImageBackground } from './resolveBackground'

describe('isImageBackground', () => {
	it('detects data, http, https and file URLs', () => {
		expect(isImageBackground('data:image/png;base64,abc')).toBe(true)
		expect(isImageBackground('https://example.com/bg.png')).toBe(true)
		expect(isImageBackground('http://example.com/bg.png')).toBe(true)
		expect(isImageBackground('file:///tmp/bg.png')).toBe(true)
	})

	it('rejects colors and empty values', () => {
		expect(isImageBackground('#FFFFFF')).toBe(false)
		expect(isImageBackground('red')).toBe(false)
		expect(isImageBackground('none')).toBe(false)
		expect(isImageBackground(undefined)).toBe(false)
	})
})

describe('isEmbeddedDataUrl', () => {
	it('detects data: image URLs including base64', () => {
		expect(isEmbeddedDataUrl('data:image/png;base64,abc')).toBe(true)
		expect(isEmbeddedDataUrl('DATA:image/jpeg;base64,/9j/')).toBe(true)
		expect(isEmbeddedDataUrl('  data:image/svg+xml;utf8,<svg/>')).toBe(true)
	})

	it('allows colors and http(s) URLs', () => {
		expect(isEmbeddedDataUrl('#1a2b3c')).toBe(false)
		expect(isEmbeddedDataUrl('red')).toBe(false)
		expect(isEmbeddedDataUrl('')).toBe(false)
		expect(isEmbeddedDataUrl('https://example.com/bg.png')).toBe(false)
		expect(isEmbeddedDataUrl('http://example.com/bg.png')).toBe(false)
		expect(isEmbeddedDataUrl('file:///tmp/bg.png')).toBe(false)
	})
})

describe('backgroundStyle', () => {
	it('returns an empty object when unset and no fallback is given', () => {
		expect(backgroundStyle(undefined)).toEqual({})
		expect(backgroundStyle('none')).toEqual({})
	})

	it('uses fallback as backgroundColor when unset', () => {
		expect(backgroundStyle(undefined, 'white')).toEqual({ backgroundColor: 'white' })
		expect(backgroundStyle('none', 'transparent')).toEqual({
			backgroundColor: 'transparent',
		})
	})

	it('uses a CSS color as backgroundColor', () => {
		expect(backgroundStyle('#1a2b3c')).toEqual({ backgroundColor: '#1a2b3c' })
		expect(backgroundStyle('red', 'white')).toEqual({ backgroundColor: 'red' })
	})

	it('uses cover image styles for image URLs', () => {
		expect(backgroundStyle('https://example.com/bg.png')).toEqual({
			backgroundImage: 'url("https://example.com/bg.png")',
			backgroundSize: 'cover',
			backgroundPosition: 'center',
		})
	})
})

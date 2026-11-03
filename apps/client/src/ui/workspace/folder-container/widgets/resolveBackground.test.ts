import { describe, expect, it } from 'vitest'
import { backgroundStyle, isBlockedFillText, isEmbeddedDataUrl, isImageBackground } from './resolveBackground'

describe('isImageBackground', () => {
	it('detects data, http, https and file URLs', () => {
		expect(isImageBackground('data:image/png;base64,abc')).toBe(true)
		expect(isImageBackground('https://example.com/bg.png')).toBe(true)
		expect(isImageBackground('http://example.com/bg.png')).toBe(true)
		expect(isImageBackground('file:///tmp/bg.png')).toBe(true)
		expect(isImageBackground('blob:http://localhost/cover')).toBe(true)
	})

	it('rejects colors and empty values', () => {
		expect(isImageBackground('#FFFFFF')).toBe(false)
		expect(isImageBackground('red')).toBe(false)
		expect(isImageBackground('none')).toBe(false)
		expect(isImageBackground(undefined)).toBe(false)
		expect(isImageBackground('pile:cover-abcdef01.webp')).toBe(false)
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
		expect(backgroundStyle('blob:http://localhost/cover')).toEqual({
			backgroundImage: 'url("blob:http://localhost/cover")',
			backgroundSize: 'cover',
			backgroundPosition: 'center',
		})
	})

	it('does not paint a pile token as a color', () => {
		expect(backgroundStyle('pile:cover-abcdef01.webp')).toEqual({})
		expect(backgroundStyle('pile:cover-abcdef01.webp', 'white')).toEqual({ backgroundColor: 'white' })
	})
})

describe('isBlockedFillText', () => {
	it('rejects a typed pile token and a data url', () => {
		expect(isBlockedFillText('pile:cover-abcdef01.webp')).toBe(true)
		expect(isBlockedFillText('  data:image/png;base64,abc')).toBe(true)
		expect(isBlockedFillText('#fff')).toBe(false)
		expect(isBlockedFillText('https://example.com/a.png')).toBe(false)
		expect(isBlockedFillText('')).toBe(false)
	})
})

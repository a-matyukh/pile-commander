import { describe, expect, it } from 'vitest'
import { demo_frame_ancestors, http_origin, is_crawler, unfurl_route } from '../middleware.ts'

describe('unfurl middleware', () => {
	it('treats TelegramBot as a crawler, not a normal browser', () => {
		expect(is_crawler('TelegramBot (like TwitterBot)')).toBe(true)
		expect(is_crawler('Slackbot-LinkExpanding 1.0')).toBe(true)
		expect(is_crawler('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe(false)
	})

	it('maps public paths', () => {
		expect(unfurl_route('/hub')).toEqual({ kind: 'hub' })
		expect(unfurl_route('/matyukh/momo')).toEqual({
			kind: 'slug',
			username: 'matyukh',
			slug: 'momo',
		})
		expect(unfurl_route('/')).toEqual({ kind: 'none' })
	})

	it('does not treat WebpageBot or in-app Telegram as TelegramBot', () => {
		expect(is_crawler('Mozilla/5.0 (compatible; Telegram)')).toBe(false)
		expect(is_crawler('WebPageBot')).toBe(false)
	})
})

describe('demo_frame_ancestors', () => {
	it('keeps frame-ancestors self when the landing URL is missing or invalid', () => {
		expect(demo_frame_ancestors('')).toBe("object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
		expect(demo_frame_ancestors('  ')).toBe("object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
		expect(demo_frame_ancestors('not-a-url')).toBe("object-src 'none'; base-uri 'self'; frame-ancestors 'self'")
		expect(demo_frame_ancestors('javascript:alert(1)')).toBe(
			"object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
		)
	})

	it('adds the landing origin when VITE_LANDING_URL is a real http(s) URL', () => {
		expect(demo_frame_ancestors('https://www.example.com/terms')).toBe(
			"object-src 'none'; base-uri 'self'; frame-ancestors 'self' https://www.example.com",
		)
		expect(demo_frame_ancestors('http://localhost:3000')).toBe(
			"object-src 'none'; base-uri 'self'; frame-ancestors 'self' http://localhost:3000",
		)
	})

	it('rejects URLs with credentials', () => {
		expect(http_origin('https://user:pass@example.com')).toBeNull()
		expect(demo_frame_ancestors('https://user:pass@example.com')).toBe(
			"object-src 'none'; base-uri 'self'; frame-ancestors 'self'",
		)
	})
})

import { describe, expect, it, vi } from 'vitest'
import {
	demo_embed_parent_origin,
	is_demo_embed_ready,
	notify_demo_embed_ready,
} from './demoEmbed'

describe('demo_embed_parent_origin', () => {
	it('prefers ancestorOrigins over referrer', () => {
		expect(demo_embed_parent_origin('https://evil.example/x', ['http://localhost:3000'])).toBe(
			'http://localhost:3000',
		)
	})

	it('falls back to the referrer origin', () => {
		expect(demo_embed_parent_origin('https://www.example.com/pricing?x=1')).toBe(
			'https://www.example.com',
		)
	})

	it('rejects missing or non-http values', () => {
		expect(demo_embed_parent_origin('')).toBeNull()
		expect(demo_embed_parent_origin('not-a-url')).toBeNull()
		expect(demo_embed_parent_origin('javascript:alert(1)')).toBeNull()
		expect(demo_embed_parent_origin('', ['ftp://files.example'])).toBeNull()
	})
})

describe('is_demo_embed_ready', () => {
	it('accepts only the landing handshake payload', () => {
		expect(is_demo_embed_ready({ source: 'pile-commander', type: 'demo-embed-ready' })).toBe(true)
		expect(is_demo_embed_ready({ source: 'pile-commander', type: 'other' })).toBe(false)
		expect(is_demo_embed_ready(null)).toBe(false)
		expect(is_demo_embed_ready('demo-embed-ready')).toBe(false)
	})
})

describe('notify_demo_embed_ready', () => {
	it('posts to the parent origin when /demo is framed', () => {
		const postMessage = vi.fn()
		const parent = { postMessage }
		notify_demo_embed_ready({
			parent,
			location: { pathname: '/demo/', ancestorOrigins: ['https://www.example.com'] },
			document: { referrer: '' },
		})
		expect(postMessage).toHaveBeenCalledWith(
			{ source: 'pile-commander', type: 'demo-embed-ready' },
			'https://www.example.com',
		)
	})

	it('does not post when this window is the top window', () => {
		const postMessage = vi.fn()
		const win: {
			parent: unknown
			location: { pathname: string }
			document: { referrer: string }
		} = {
			parent: { postMessage },
			location: { pathname: '/demo' },
			document: { referrer: 'https://www.example.com/' },
		}
		win.parent = win
		notify_demo_embed_ready(win)
		expect(postMessage).not.toHaveBeenCalled()
	})

	it('does not post on other routes', () => {
		const postMessage = vi.fn()
		notify_demo_embed_ready({
			parent: { postMessage },
			location: { pathname: '/hub' },
			document: { referrer: 'https://www.example.com/' },
		})
		expect(postMessage).not.toHaveBeenCalled()
	})

	it('does not post when the parent origin is unknown', () => {
		const postMessage = vi.fn()
		const parent = { postMessage }
		notify_demo_embed_ready({
			parent,
			location: { pathname: '/demo' },
			document: { referrer: '' },
		})
		expect(postMessage).not.toHaveBeenCalled()
	})
})

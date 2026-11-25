// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { hold_external_media, host_of, is_private_address, loads_from_elsewhere } from './externalAddress'

describe('loads_from_elsewhere', () => {
	const app = 'https://www.pile-commander.app'
	test('another site, with or without the scheme', () => {
		expect(loads_from_elsewhere('https://images.unsplash.com/a.jpg', app)).toBe(true)
		expect(loads_from_elsewhere('http://example.com/a.png', app)).toBe(true)
		expect(loads_from_elsewhere('//example.com/a.png', app)).toBe(true)
		expect(loads_from_elsewhere('  HTTPS://Example.com/a.png', app)).toBe(true)
	})

	test('what the app already holds or makes itself', () => {
		expect(loads_from_elsewhere('blob:https://www.pile-commander.app/1b2c', app)).toBe(false)
		expect(loads_from_elsewhere('data:image/png;base64,AAAA', app)).toBe(false)
		expect(loads_from_elsewhere('pile:cover-aaaaaaaa.webp', app)).toBe(false)
		expect(loads_from_elsewhere('cover.png', app)).toBe(false)
		expect(loads_from_elsewhere('#ffcc00', app)).toBe(false)
		expect(loads_from_elsewhere('https://www.pile-commander.app/demo-pack/a.png', app)).toBe(false)
		expect(loads_from_elsewhere('', app)).toBe(false)
		expect(loads_from_elsewhere(undefined, app)).toBe(false)
	})
})

describe('is_private_address', () => {
	test('this computer and the networks around it, however the address is written', () => {
		for (const address of [
			'http://localhost:8080/x', 'http://127.0.0.1/', 'http://127.1/', 'http://2130706433/', 'http://0x7f.0.0.1/',
			'http://10.0.0.5/a.png', 'http://172.16.3.4/', 'http://172.31.255.255/', 'http://192.168.1.1/admin',
			'http://169.254.169.254/latest/meta-data', 'http://100.64.0.1/', 'http://0.0.0.0/',
			'http://[::1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://[::ffff:192.168.1.1]/',
			'http://printer.local/', 'http://nas.lan/', 'http://router/', 'https://service.internal/x', 'not an address',
		]) expect(is_private_address(address), address).toBe(true)
	})

	test('the public internet', () => {
		for (const address of [
			'https://images.unsplash.com/a.jpg', 'http://8.8.8.8/', 'http://172.32.0.1/', 'http://192.169.1.1/',
			'https://[2606:4700::1111]/', '//example.com/a.png', 'https://localhost.example.com/',
		]) expect(is_private_address(address), address).toBe(false)
	})
})

describe('hold_external_media', () => {
	const refuse_others = (address: string) => !/^https?:|^\/\//.test(address)

	test('a held picture keeps its place and its words, and loads nothing', () => {
		const { html, held } = hold_external_media('<p>before <img src="https://evil.example/t.png" alt="chart"> after</p>', refuse_others)
		expect(held).toBe(1)
		expect(html).toBe('<p>before <img alt="chart" data-held-src="https://evil.example/t.png"> after</p>')
	})

	test('every way an element loads: src, srcset, poster', () => {
		const { html, held } = hold_external_media(
			'<video poster="https://a.example/p.jpg" src="https://a.example/v.mp4"></video>'
			+ '<img srcset="https://a.example/1.png 1x, own.png 2x" src="own.png">'
			+ '<audio src="//a.example/s.mp3"></audio>',
			refuse_others,
		)
		expect(held).toBe(4)
		expect(html).not.toContain('a.example/p.jpg"')
		expect(html).not.toMatch(/\s(?:src|poster|srcset)="(?:https?:)?\/\//)
		expect(html).toContain('src="own.png"')
	})

	test('a note that loads nothing, or only what is allowed, comes back as it was', () => {
		const plain = '<p>src = "https://a.example" is just text</p>'
		expect(hold_external_media(plain, refuse_others)).toEqual({ html: plain, held: 0 })
		const own = '<p><img src="blob:x" alt="a"><img src="data:image/png;base64,AA"></p>'
		expect(hold_external_media(own, refuse_others)).toEqual({ html: own, held: 0 })
		const allowed = '<img src="https://a.example/t.png">'
		expect(hold_external_media(allowed, () => true)).toEqual({ html: allowed, held: 0 })
	})
})

describe('host_of', () => {
	test('names the site', () => {
		expect(host_of('https://images.unsplash.com/photo-1?w=2')).toBe('images.unsplash.com')
		expect(host_of('nope')).toBeNull()
	})
})

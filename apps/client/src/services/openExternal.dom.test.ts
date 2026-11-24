// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from 'vitest'
import { clicked_link, is_editing_link, listen_external_links } from './openExternal'

describe('is_editing_link', () => {
	const link = (editable: boolean) => {
		const box = document.createElement('div')
		if (editable) box.setAttribute('contenteditable', 'true')
		box.innerHTML = '<p><a href="https://example.com">x</a></p>'
		return box.querySelector('a')!
	}

	test('a click on a link in a note being edited puts the caret there', () => {
		expect(is_editing_link(link(true), { button: 0, metaKey: false, ctrlKey: false })).toBe(true)
	})

	test('Cmd/Ctrl+click and a link outside editing open the link', () => {
		expect(is_editing_link(link(true), { button: 0, metaKey: true, ctrlKey: false })).toBe(false)
		expect(is_editing_link(link(true), { button: 0, metaKey: false, ctrlKey: true })).toBe(false)
		expect(is_editing_link(link(false), { button: 0, metaKey: false, ctrlKey: false })).toBe(false)
	})
})

describe('clicked_link', () => {
	const inside = (html: string, selector: string) => {
		const box = document.createElement('div')
		box.innerHTML = html
		document.body.appendChild(box)
		return box.querySelector(selector)!
	}

	afterEach(() => { document.body.innerHTML = '' })

	test('an HTML link, from the element inside it', () => {
		const link = clicked_link(inside('<a href="https://example.com/a"><b>x</b></a>', 'b'))
		expect(link?.href).toBe('https://example.com/a')
	})

	test('an area of an image map', () => {
		const link = clicked_link(inside('<map name="m"><area shape="rect" coords="0,0,9,9" href="https://evil.example/login"></map>', 'area'))
		expect(link?.href).toBe('https://evil.example/login')
	})

	test('an SVG link, with the address in href or xlink:href', () => {
		const plain = clicked_link(inside('<svg><a href="https://evil.example/a"><rect width="9" height="9"/></a></svg>', 'rect'))
		expect(plain?.href).toBe('https://evil.example/a')
		const xlink = clicked_link(inside(
			'<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://evil.example/b"><rect width="9" height="9"/></a></svg>',
			'rect',
		))
		expect(xlink?.href).toBe('https://evil.example/b')
	})

	test('nothing for plain content and for a link without an address', () => {
		expect(clicked_link(inside('<p><b>x</b></p>', 'b'))).toBeNull()
		expect(clicked_link(inside('<a name="top"><b>x</b></a>', 'b'))).toBeNull()
		expect(clicked_link(null)).toBeNull()
	})
})

describe('listen_external_links', () => {
	const opened: string[] = []
	let stop: (() => void) | null = null

	const click = (html: string, selector: string, init: MouseEventInit = {}) => {
		const box = document.createElement('div')
		box.innerHTML = html
		document.body.appendChild(box)
		const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init })
		box.querySelector(selector)!.dispatchEvent(event)
		return event
	}

	const listen = () => {
		opened.length = 0
		vi.spyOn(window, 'open').mockImplementation((url) => { opened.push(String(url)); return null })
		stop = listen_external_links(() => {})
	}

	afterEach(() => {
		stop?.()
		stop = null
		vi.restoreAllMocks()
		document.body.innerHTML = ''
	})

	test('a web link opens outside this window instead of replacing the app', () => {
		listen()
		const event = click('<a href="https://example.com/page">x</a>', 'a')
		expect(event.defaultPrevented).toBe(true)
		expect(opened).toEqual(['https://example.com/page'])
	})

	test('an image-map area and an SVG link are caught too', () => {
		listen()
		const area = click('<map name="m"><area shape="rect" coords="0,0,9,9" href="https://evil.example/login"></map>', 'area')
		const svg = click('<svg><a href="https://evil.example/svg"><rect width="9" height="9"/></a></svg>', 'rect')
		expect(area.defaultPrevented).toBe(true)
		expect(svg.defaultPrevented).toBe(true)
		expect(opened).toEqual(['https://evil.example/login', 'https://evil.example/svg'])
	})

	test('a download attribute does not let another site\'s address through', () => {
		listen()
		const event = click('<a href="https://evil.example/login" download>x</a>', 'a')
		expect(event.defaultPrevented).toBe(true)
		expect(opened).toEqual(['https://evil.example/login'])
	})

	test('the app\'s own downloads and links stay with the page', () => {
		listen()
		const blob = click('<a href="blob:http://localhost/1b2c" download="a.pile">x</a>', 'a')
		const data = click('<a href="data:text/plain,hi" download="a.txt">x</a>', 'a')
		const own = click(`<a href="${window.location.origin}/hub">x</a>`, 'a')
		expect(blob.defaultPrevented).toBe(false)
		expect(data.defaultPrevented).toBe(false)
		expect(own.defaultPrevented).toBe(false)
		expect(opened).toEqual([])
	})

	test('a right click keeps the context menu', () => {
		listen()
		const event = click('<a href="https://example.com/page">x</a>', 'a', { button: 2 })
		expect(event.defaultPrevented).toBe(false)
		expect(opened).toEqual([])
	})
})

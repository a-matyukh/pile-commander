// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { render_note_html } from './render'
import { toggle_task } from './tasks'

const dom = (md: string) => {
	const element = document.createElement('div')
	element.innerHTML = render_note_html(md)
	return element
}

describe('render_note_html', () => {
	test('renders the note schema', () => {
		const html = render_note_html('# Title\n\n**bold** *it* `code`\nnext line')
		expect(html).toBe('<h1>Title</h1><p><strong>bold</strong> <em>it</em> <code>code</code><br>next line</p>')
	})

	test('task boxes are checkboxes in document order, as toggle_task counts them', () => {
		const md = '- [ ] a\n  - [x] b\n- plain\n- [ ] c\n\n1. [ ] ordered is text\n- [ ]\n\n```\n- [ ] code\n```'
		const boxes = [...dom(md).querySelectorAll<HTMLInputElement>('li[data-type="taskItem"] > label > input[type="checkbox"]')]
		expect(boxes.map(box => box.checked)).toEqual([false, true, false])
		expect(toggle_task(md, 2, true)).not.toBeNull()
		expect(toggle_task(md, 3, true)).toBeNull()
	})

	test('a colour of the palette shows, another does not', () => {
		expect(dom('<span style="color: #c53a33">r</span>').querySelector('span')?.getAttribute('style')).toMatch(/color/)
		expect(dom('<span style="color: #123456">x</span>').querySelector('span')).toBeNull()
		expect(dom('<mark>h</mark>').querySelector('mark')?.getAttribute('style')).toMatch(/background-color/)
	})

	test('a javascript: link loses its address; an image only loads from the web, data or a path', () => {
		expect(dom('[x](javascript:alert(1))').querySelector('a')?.getAttribute('href') ?? '').not.toMatch(/javascript/i)
		expect(dom('![x](javascript:alert(1))').querySelector('img')?.hasAttribute('src')).toBe(false)
		expect(dom('![x](data:image/png;base64,AAAA)').querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,AAAA')
		expect(dom('![x](pics/a.png)').querySelector('img')?.getAttribute('src')).toBe('pics/a.png')
	})

	test('a code block names its language in a data attribute, never a class', () => {
		const code = dom('```fixed inset-0 z-50\nx\n```').querySelector('code')
		expect(code?.getAttribute('data-language')).toBe('fixed')
		expect(code?.hasAttribute('class')).toBe(false)
	})

	test('raw HTML goes through the note sanitizer', () => {
		const element = dom('<div class="fixed inset-0" style="position: fixed; color: #c53a33" onclick="alert(1)">\n<script>alert(1)</script><style>body{display:none}</style>\n</div>')
		expect(element.querySelector('script, style')).toBeNull()
		expect(element.querySelector('[class], [onclick]')).toBeNull()
		expect(element.innerHTML).not.toMatch(/position/)
	})

	test('a raw block shows its HTML; markdown inside <details> renders', () => {
		const element = dom('<details>\n<summary>More</summary>\n\nHidden **body**\n\n</details>')
		expect(element.querySelector('details > summary')?.textContent).toBe('More')
		expect(element.querySelector('details strong')?.textContent).toBe('body')
	})

	test('front matter shows as its source; an inline comment shows nothing', () => {
		expect(dom('---\ntitle: Trip\n---\n# Plan').querySelector('pre[data-front-matter]')?.textContent).toBe('---\ntitle: Trip\n---')
		const element = dom('a <!-- hidden --> b <kbd>K</kbd>')
		expect(element.textContent).toBe('a  b K')
		expect(element.querySelector('kbd')?.textContent).toBe('K')
	})

	test('alignment and callouts', () => {
		expect(dom('<p align="center">c</p>').querySelector('p')?.getAttribute('style')).toMatch(/text-align: center/)
		expect(dom('> [!WARNING]\n> careful').querySelector('div[data-callout="warning"] p')?.textContent).toBe('careful')
	})

	test('the same text renders once, an empty note to nothing', () => {
		expect(render_note_html('cached **once**')).toBe(render_note_html('cached **once**'))
		expect(render_note_html('')).toBe('')
	})
})

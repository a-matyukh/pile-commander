// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { parseNoteMarkdown } from './markdown'

// The path that ships: DOMPurify on a real DOM. markdown.test.ts covers the
// regex fallback the node environment gets.
describe('parseNoteMarkdown with DOMPurify', () => {
	test('runs DOMPurify, not the regex fallback', () => {
		// The fallback does not decode entities, so it would keep this link.
		const html = parseNoteMarkdown('<a href="&#106;avascript:alert(1)">x</a>')
		expect(html).toContain('x')
		expect(html).not.toContain('href')
	})

	test('drops a style element with its rules', () => {
		const html = parseNoteMarkdown('hi <style>body { display: none }</style>')
		expect(html).toContain('hi')
		expect(html).not.toContain('<style')
		expect(html).not.toContain('display')
	})

	test('keeps only text styling in a style attribute', () => {
		const html = parseNoteMarkdown('<span style="color: #c00; position: fixed; inset: 0; z-index: 9999">x</span>')
		expect(html).toContain('<span style="color: #c00">x</span>')
		expect(html).not.toContain('position')
		const image = parseNoteMarkdown('<p style="background:url(https://evil.example/b.png)">x</p>')
		expect(image).toContain('<p>x</p>')
		expect(image).not.toContain('style')
	})

	test('drops classes', () => {
		const html = parseNoteMarkdown('<div class="fixed inset-0 z-50 bg-white">x</div>')
		expect(html).toContain('x')
		expect(html).not.toContain('class=')
	})

	test('drops a form and keeps its text', () => {
		const html = parseNoteMarkdown('<form action="https://evil.example/login">Password: <input name="p"></form>')
		expect(html).not.toContain('<form')
		expect(html).not.toContain('evil.example')
		expect(html).toContain('Password:')
	})

	test('leaves nothing to type into or press, and keeps the words', () => {
		const html = parseNoteMarkdown([
			'<p>Session expired. Password: <input type="password" placeholder="Password"></p>',
			'<textarea>your notes</textarea>',
			'<select><option>Work</option><option>Home</option></select>',
			'<button onclick="x()">Sign in</button>',
			'<fieldset><legend>Account</legend><input type="text" value="me"></fieldset>',
		].join('\n\n'))
		for (const tag of ['<input', '<textarea', '<select', '<option', '<button', '<fieldset', '<legend']) {
			expect(html).not.toContain(tag)
		}
		expect(html).toContain('Session expired. Password:')
		expect(html).toContain('your notes')
		expect(html).toContain('Sign in')
	})

	test('a task checkbox stays a checkbox and nothing more', () => {
		const html = parseNoteMarkdown('<input type="checkbox" checked name="agree" value="1" autofocus formaction="https://evil.example">')
		expect(html).toMatch(/<input[^>]*type="checkbox"/)
		expect(html).toContain('checked')
		for (const attr of ['name', 'value', 'autofocus', 'formaction', 'evil.example']) {
			expect(html).not.toContain(attr)
		}
		// an <input> of another kind dressed as one is still dropped
		expect(parseNoteMarkdown('<input type="image" src="https://evil.example/a.png">')).not.toContain('<input')
		expect(parseNoteMarkdown('<input>')).not.toContain('<input')
	})

	test('media waits for the reader, and nothing takes the focus', () => {
		const html = parseNoteMarkdown('<video autoplay loop controls src="https://example.com/a.mp4"></video><audio autoplay src="https://example.com/a.mp3"></audio><a href="https://example.com" autofocus>x</a>')
		expect(html).toContain('<video')
		expect(html).toContain('controls')
		expect(html).toContain('<audio')
		expect(html).not.toContain('autoplay')
		expect(html).not.toContain('autofocus')
	})

	test('a note cannot name itself after the app\'s own elements', () => {
		const html = parseNoteMarkdown('<div id="app" name="app" data-id="/other/folder" data-path="/other" data-drop-root data-tauri-drag-region>x</div>')
		expect(html).toContain('x')
		for (const attr of ['id=', 'name=', 'data-id', 'data-path', 'data-drop-root', 'data-tauri-drag-region']) {
			expect(html).not.toContain(attr)
		}
		// the marks a note's own rendering reads stay
		const own = parseNoteMarkdown('<ul data-type="taskList"><li data-type="taskItem" data-checked="true">x</li></ul><div data-callout="note">y</div><code data-language="ts">z</code>')
		for (const attr of ['data-type="taskList"', 'data-checked="true"', 'data-callout="note"', 'data-language="ts"']) {
			expect(own).toContain(attr)
		}
	})

	test('keeps what notes use: task checkboxes, callouts, links, code', () => {
		const html = parseNoteMarkdown('- [x] done\n\n<aside>\n**Tip**\n</aside>\n\n[site](https://example.com) `code`\n\n```ts\nconst a = 1\n```')
		expect(html).toMatch(/<input[^>]*type="checkbox"/)
		expect(html).toContain('<aside>')
		expect(html).toContain('<a href="https://example.com">site</a>')
		expect(html).toContain('<code>code</code>')
		expect(html).toContain('const a = 1')
	})

	test('leaves the shared DOMPurify alone (shape fills live in style)', async () => {
		const { default: DOMPurify } = await import('dompurify')
		const svg = DOMPurify.sanitize('<svg><rect style="fill:#6366f1;stroke:none" width="10" height="10"/></svg>', {
			USE_PROFILES: { svg: true },
		})
		expect(svg).toContain('fill:#6366f1')
	})

	test('an image map cannot cover a note with a link', () => {
		const html = parseNoteMarkdown(
			'<img src="https://example.com/a.png" usemap="#m"><map name="m"><area shape="rect" coords="0,0,9999,9999" href="https://evil.example/login"></map>',
		)
		expect(html).toContain('<img')
		expect(html).not.toContain('<map')
		expect(html).not.toContain('<area')
		expect(html).not.toContain('usemap')
		expect(html).not.toContain('evil.example')
	})

	test('a link inside svg loses its address and keeps what it draws', () => {
		const html = parseNoteMarkdown(
			'<svg width="400" height="300"><a href="https://evil.example/login"><rect width="400" height="300" fill="transparent"></rect></a></svg>',
		)
		expect(html).toContain('<rect')
		expect(html).not.toContain('evil.example')
		const xlink = parseNoteMarkdown(
			'<svg xmlns:xlink="http://www.w3.org/1999/xlink"><a xlink:href="https://evil.example/x"><rect width="9" height="9"></rect></a></svg>',
		)
		expect(xlink).not.toContain('evil.example')
	})

	test('an ordinary link keeps its address', () => {
		const html = parseNoteMarkdown('[site](https://example.com/page)')
		expect(html).toContain('<a href="https://example.com/page">site</a>')
	})
})

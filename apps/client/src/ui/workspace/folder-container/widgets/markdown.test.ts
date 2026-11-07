import { describe, expect, test } from 'vitest'
import { parseNoteMarkdown } from './markdown'

describe('parseNoteMarkdown', () => {
	test('returns empty string for empty input', () => {
		expect(parseNoteMarkdown('')).toBe('')
	})

	test('renders a paragraph for plain text', () => {
		expect(parseNoteMarkdown('hello')).toContain('<p>hello</p>')
	})

	test('treats single newlines as breaks', () => {
		const html = parseNoteMarkdown('line1\nline2')
		expect(html).toContain('line1')
		expect(html).toContain('line2')
		expect(html).toMatch(/<br\s*\/?>/i)
	})

	test('renders bold markdown', () => {
		expect(parseNoteMarkdown('**bold**')).toContain('<strong>bold</strong>')
	})

	// Note bodies come from shared and public boards, i.e. from other users.
	// These run in the node environment, so they cover the regex fallback; the
	// browser path is DOMPurify, which is strictly stricter
	test('drops inline event handlers', () => {
		const html = parseNoteMarkdown('<a href="#" onclick="alert(1)">x</a>')
		expect(html).not.toContain('onclick')
	})

	test('drops script and iframe tags', () => {
		expect(parseNoteMarkdown('<script>alert(1)</script>')).not.toContain('<script')
		expect(parseNoteMarkdown('<iframe src="//evil"></iframe>')).not.toContain('<iframe')
	})

	test('drops javascript: and data: urls', () => {
		expect(parseNoteMarkdown('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
		expect(parseNoteMarkdown('<img src="data:text/html,<script>">')).not.toContain('data:text/html')
	})

	// A note must not restyle or cover the app it is shown in.
	// markdown.dom.test.ts runs the same cases through DOMPurify.
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
		expect(parseNoteMarkdown('<p style="background:url(https://evil.example/b.png)">x</p>')).not.toMatch(/\sstyle\s*=/)
	})

	test('drops classes, so the app\'s own utility classes do not apply', () => {
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

	// Notion exports a callout as an <aside>. The closing tag used to land
	// inside the last list item, and markdown on the first line was left raw.
	test('renders a Notion callout as one aside', () => {
		const html = parseNoteMarkdown(
			'<aside>\n\nimage title and description\n\nчтобы картинки по умолчанию были с прозрачным фоном либо\nэто можно в настройках указать\n\n- картинке добавить подпись независимо от размера (description)\n</aside>',
		)
		expect(html).toContain('<aside>')
		expect(html).toContain('<li>картинке добавить подпись независимо от размера (description)</li>')
		expect(html).not.toMatch(/<\/aside><\/li>/)
		expect(html.indexOf('<aside>')).toBeLessThan(html.indexOf('<li>'))
		expect(html.indexOf('</aside>')).toBeGreaterThan(html.indexOf('</ul>'))
	})

	test('parses markdown on the first line of a callout', () => {
		const html = parseNoteMarkdown('<aside>\n💡 **Note**\n\nbody\n</aside>')
		expect(html).toContain('<strong>Note</strong>')
		expect(html).toContain('<p>body</p>')
		expect(html.startsWith('<aside>')).toBe(true)
		expect(html.trimEnd().endsWith('</aside>')).toBe(true)
	})

	test('drops a script inside a callout', () => {
		const html = parseNoteMarkdown('<aside>\n\n<script>alert(1)</script>\n</aside>')
		expect(html).not.toContain('<script')
		expect(html).not.toContain('alert(1)')
	})
})

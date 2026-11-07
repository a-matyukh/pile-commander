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
})

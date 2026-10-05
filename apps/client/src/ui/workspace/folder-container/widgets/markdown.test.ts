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
})

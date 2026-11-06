import { expect, test } from 'vitest'
import { normalize_href } from './links'

test('normalize_href makes a typed address a link', () => {
	expect(normalize_href('example.com')).toBe('https://example.com')
	expect(normalize_href('  example.com/a?b=1  ')).toBe('https://example.com/a?b=1')
	expect(normalize_href('me@example.com')).toBe('mailto:me@example.com')
	expect(normalize_href('http://x.y')).toBe('http://x.y')
	expect(normalize_href('mailto:a@b.c')).toBe('mailto:a@b.c')
	expect(normalize_href('#top')).toBe('#top')
	expect(normalize_href('/docs')).toBe('/docs')
	expect(normalize_href('')).toBe('')
})

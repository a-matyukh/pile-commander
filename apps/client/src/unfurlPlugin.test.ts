import { expect, test } from 'vitest'
import { html_request_pathname } from '../unfurlPlugin.ts'

test('prefers originalUrl over the SPA fallback /index.html', () => {
	expect(html_request_pathname({
		path: '/index.html',
		filename: '/index.html',
		originalUrl: '/matyukh/momo?x=1',
	})).toBe('/matyukh/momo')
})

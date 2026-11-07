import { describe, expect, test } from 'vitest'
import { external_target } from './openExternal'

describe('external_target', () => {
	test('the browser opens other sites in a new tab and keeps its own links', () => {
		expect(external_target('https://example.com/a', 'https://app.pile.test', false)).toBe('tab')
		expect(external_target('/hub', 'https://app.pile.test', false)).toBeNull()
		expect(external_target('https://app.pile.test/me/board', 'https://app.pile.test', false)).toBeNull()
		expect(external_target('mailto:a@b.c', 'https://app.pile.test', false)).toBeNull()
	})

	test('the desktop sends web, mail and phone links to the system', () => {
		expect(external_target('https://example.com', 'tauri://localhost', true)).toBe('system')
		expect(external_target('http://localhost:3000', 'tauri://localhost', true)).toBe('system')
		expect(external_target('mailto:a@b.c', 'tauri://localhost', true)).toBe('system')
	})

	test('leaves app-internal, blob and anchor links alone', () => {
		expect(external_target('#section', 'tauri://localhost', true)).toBeNull()
		expect(external_target('blob:tauri://localhost/123', 'tauri://localhost', true)).toBeNull()
		expect(external_target('javascript:void(0)', 'https://app.pile.test', false)).toBeNull()
	})
})

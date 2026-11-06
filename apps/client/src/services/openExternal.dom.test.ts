// @vitest-environment jsdom
import { describe, expect, test } from 'vitest'
import { is_editing_link } from './openExternal'

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

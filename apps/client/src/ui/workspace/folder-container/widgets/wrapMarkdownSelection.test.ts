import { describe, expect, test } from 'vitest'
import { wrapMarkdownSelection } from './wrapMarkdownSelection'

describe('wrapMarkdownSelection', () => {
	test('wraps a selection in bold markers and keeps the inner text selected', () => {
		expect(wrapMarkdownSelection('say hello there', 4, 9, '**')).toEqual({
			text: 'say **hello** there',
			selectionStart: 6,
			selectionEnd: 11,
		})
	})

	test('wraps a selection in italic markers and keeps the inner text selected', () => {
		expect(wrapMarkdownSelection('say hello there', 4, 9, '*')).toEqual({
			text: 'say *hello* there',
			selectionStart: 5,
			selectionEnd: 10,
		})
	})

	test('inserts markers at the caret when nothing is selected', () => {
		expect(wrapMarkdownSelection('ab', 1, 1, '**')).toEqual({
			text: 'a****b',
			selectionStart: 3,
			selectionEnd: 3,
		})
		expect(wrapMarkdownSelection('ab', 1, 1, '*')).toEqual({
			text: 'a**b',
			selectionStart: 2,
			selectionEnd: 2,
		})
	})

	test('unwraps when the same bold markers already surround the selection', () => {
		expect(wrapMarkdownSelection('say **hello** there', 6, 11, '**')).toEqual({
			text: 'say hello there',
			selectionStart: 4,
			selectionEnd: 9,
		})
	})

	test('unwraps when the same italic markers already surround the selection', () => {
		expect(wrapMarkdownSelection('say *hello* there', 5, 10, '*')).toEqual({
			text: 'say hello there',
			selectionStart: 4,
			selectionEnd: 9,
		})
	})

	test('unwraps markers around an empty caret', () => {
		expect(wrapMarkdownSelection('a****b', 3, 3, '**')).toEqual({
			text: 'ab',
			selectionStart: 1,
			selectionEnd: 1,
		})
		expect(wrapMarkdownSelection('a**b', 2, 2, '*')).toEqual({
			text: 'ab',
			selectionStart: 1,
			selectionEnd: 1,
		})
	})

	test('italic does not unwrap the stars of bold text', () => {
		expect(wrapMarkdownSelection('**hello**', 2, 7, '*')).toEqual({
			text: '***hello***',
			selectionStart: 3,
			selectionEnd: 8,
		})
	})

	test('normalizes a backwards selection', () => {
		expect(wrapMarkdownSelection('hello', 5, 0, '**')).toEqual({
			text: '**hello**',
			selectionStart: 2,
			selectionEnd: 7,
		})
	})
})

import { describe, expect, test } from 'vitest'
import makeSelection from './selection'

describe('click_select', () => {
	test('a click picks one item, a click on another picks that one instead', () => {
		const s = makeSelection()
		s.click_select('a')
		expect(s.selection).toEqual(['a'])
		s.click_select('b')
		expect(s.selection).toEqual(['b'])
	})

	test('a second click on the only selected item lets it go', () => {
		const s = makeSelection()
		s.click_select('a')
		s.click_select('a')
		expect(s.selection).toEqual([])
	})

	test('Shift, ⌘ and Ctrl add and take away', () => {
		const s = makeSelection()
		s.click_select('a')
		s.click_select('b', { shiftKey: true })
		s.click_select('c', { metaKey: true })
		expect(s.selection).toEqual(['a', 'b', 'c'])
		s.click_select('b', { ctrlKey: true })
		expect(s.selection).toEqual(['a', 'c'])
	})

	test('a plain click among several selected picks that one alone', () => {
		const s = makeSelection()
		s.set_selection(['a', 'b'])
		s.click_select('a')
		expect(s.selection).toEqual(['a'])
	})

	test('in Select mode a tap adds and takes away', () => {
		const s = makeSelection()
		s.enter_selection_mode()
		s.click_select('a')
		s.click_select('b')
		expect(s.selection).toEqual(['a', 'b'])
		s.click_select('a')
		expect(s.selection).toEqual(['b'])
	})
})

describe('context_select', () => {
	test('a right click on an item that is not selected picks it alone', () => {
		const s = makeSelection()
		s.set_selection(['a', 'b'])
		s.context_select('c')
		expect(s.selection).toEqual(['c'])
	})

	test('a right click on a selected item keeps the whole selection', () => {
		const s = makeSelection()
		s.set_selection(['a', 'b'])
		s.context_select('b')
		expect(s.selection).toEqual(['a', 'b'])
	})

	test('in Select mode a right click adds the item', () => {
		const s = makeSelection()
		s.enter_selection_mode()
		s.select('a')
		s.context_select('b')
		expect(s.selection).toEqual(['a', 'b'])
	})
})

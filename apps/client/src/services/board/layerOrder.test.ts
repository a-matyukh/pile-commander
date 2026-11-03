import { describe, expect, test } from 'vitest'
import { layer_order, layer_step_from_key } from './layerOrder'

const ids = ['a', 'b', 'c', 'd']

describe('layer_order', () => {
	test('front and back move one id, and do nothing at the edge', () => {
		expect(layer_order(ids, ['b'], 'front')).toEqual(['a', 'c', 'd', 'b'])
		expect(layer_order(ids, ['d'], 'front')).toBeNull()
		expect(layer_order(ids, ['c'], 'back')).toEqual(['c', 'a', 'b', 'd'])
		expect(layer_order(ids, ['a'], 'back')).toBeNull()
	})

	test('forward and backward swap with the neighbour', () => {
		expect(layer_order(ids, ['b'], 'forward')).toEqual(['a', 'c', 'b', 'd'])
		expect(layer_order(ids, ['b'], 'backward')).toEqual(['b', 'a', 'c', 'd'])
		expect(layer_order(ids, ['d'], 'forward')).toBeNull()
		expect(layer_order(ids, ['a'], 'backward')).toBeNull()
	})

	test('a block keeps its order and steps past the next item together', () => {
		expect(layer_order(ids, ['a', 'c'], 'front')).toEqual(['b', 'd', 'a', 'c'])
		expect(layer_order(ids, ['b', 'c'], 'forward')).toEqual(['a', 'd', 'b', 'c'])
		expect(layer_order(ids, ['b', 'c'], 'backward')).toEqual(['b', 'c', 'a', 'd'])
		expect(layer_order(ids, ['a', 'c'], 'back')).toEqual(['a', 'c', 'b', 'd'])
	})

	test('ids outside the folder are ignored', () => {
		expect(layer_order(ids, ['missing'], 'front')).toBeNull()
		expect(layer_order(ids, ['b', 'missing'], 'front')).toEqual(['a', 'c', 'd', 'b'])
		expect(layer_order(ids, [], 'forward')).toBeNull()
	})
})

describe('layer_step_from_key', () => {
	const key = (code: string, over: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {}) =>
		({ code, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...over })

	test('brackets jump, command steps', () => {
		expect(layer_step_from_key(key('BracketRight'))).toBe('front')
		expect(layer_step_from_key(key('BracketLeft'))).toBe('back')
		expect(layer_step_from_key(key('BracketRight', { metaKey: true }))).toBe('forward')
		expect(layer_step_from_key(key('BracketLeft', { ctrlKey: true }))).toBe('backward')
	})

	test('shift, alt and other keys do nothing', () => {
		expect(layer_step_from_key(key('BracketRight', { shiftKey: true }))).toBeNull()
		expect(layer_step_from_key(key('BracketLeft', { altKey: true }))).toBeNull()
		expect(layer_step_from_key(key('KeyA'))).toBeNull()
	})
})

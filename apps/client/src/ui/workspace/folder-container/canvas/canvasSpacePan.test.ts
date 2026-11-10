import { describe, expect, test } from 'vitest'
import {
	SPACE_PAN_IDLE,
	is_space,
	space_pan_next,
	starts_space_pan,
	type SpacePanEvent,
} from './canvasSpacePan'

const plain = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false }

function after(...events: SpacePanEvent[]) {
	return events.reduce(space_pan_next, SPACE_PAN_IDLE)
}

describe('the Space key', () => {
	test('is known by its place and by what it types', () => {
		expect(is_space({ code: 'Space', key: ' ' })).toBe(true)
		expect(is_space({ code: 'Space', key: 'Unidentified' })).toBe(true)
		expect(is_space({ code: '', key: ' ' })).toBe(true)
		expect(is_space({ code: 'KeyH', key: 'h' })).toBe(false)
	})

	test('starts a pan only without modifiers', () => {
		expect(starts_space_pan({ code: 'Space', key: ' ', ...plain })).toBe(true)
		expect(starts_space_pan({ code: 'Space', key: ' ', ...plain, shiftKey: true })).toBe(false)
		expect(starts_space_pan({ code: 'Space', key: ' ', ...plain, metaKey: true })).toBe(false)
		expect(starts_space_pan({ code: 'Space', key: ' ', ...plain, ctrlKey: true })).toBe(false)
		expect(starts_space_pan({ code: 'Space', key: ' ', ...plain, altKey: true })).toBe(false)
		expect(starts_space_pan({ code: 'KeyH', key: 'h', ...plain })).toBe(false)
	})
})

describe('space_pan_next', () => {
	test('holding Space pans, letting go brings the tool back', () => {
		expect(after('key_down').held).toBe(true)
		expect(after('key_down', 'key_up')).toEqual(SPACE_PAN_IDLE)
	})

	test('a drag under Space goes on until the button is released', () => {
		expect(after('key_down', 'pointer_down', 'pointer_up').held).toBe(true)
	})

	test('Space let go mid-drag keeps the pan until the drag ends', () => {
		const mid = after('key_down', 'pointer_down', 'key_up')
		expect(mid.held).toBe(true)
		expect(mid.release_pending).toBe(true)
		expect(space_pan_next(mid, 'pointer_up')).toEqual(SPACE_PAN_IDLE)
	})

	test('Space pressed again during that drag keeps the pan after it', () => {
		const again = after('key_down', 'pointer_down', 'key_up', 'key_down')
		expect(again.release_pending).toBe(false)
		expect(space_pan_next(again, 'pointer_up').held).toBe(true)
	})

	test('Space during a stroke or a drag already begun changes nothing', () => {
		const mid_stroke = after('pointer_down', 'key_down')
		expect(mid_stroke.held).toBe(false)
		// and its release is not a release of anything
		expect(space_pan_next(mid_stroke, 'key_up').held).toBe(false)
		expect(after('pointer_down', 'key_down', 'key_up', 'pointer_up')).toEqual(SPACE_PAN_IDLE)
	})

	test('a key up that was never down is ignored', () => {
		expect(after('key_up')).toEqual(SPACE_PAN_IDLE)
	})

	test('a reset drops everything: the window lost focus mid-hold', () => {
		expect(after('key_down', 'pointer_down', 'reset')).toEqual(SPACE_PAN_IDLE)
	})
})

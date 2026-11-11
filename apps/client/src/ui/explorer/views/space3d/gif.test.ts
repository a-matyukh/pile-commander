import { describe, expect, test } from 'vitest'
import { gif_fullest_frame } from './gif'

/**
 * Made with Pillow, palette: 1 red, 2 blue, 3 green, 4 yellow; 0 is transparent where the GIF has transparency.
 * blank_start: 40×40, three frames kept on top of each other: nothing, a red 4×4 square, then rows of
 * red, blue, green over the whole canvas; that last frame is interlaced.
 */
const BLANK_START = 'R0lGODlhKAAoAIIAAAAAAP8AAAAA/wCgAP/cAP///4CAgEBAQCH/C05FVFNDQVBFMi4wAwEAAAAh+QQFBAAAACwAAAAAKAAoAAAIQwABCBxIsKDBgwgTKlzIsKHDhxAjSpxIsaLFixgzatzIsaPHjyBDihxJsqTJkyhTqlzJsqXLlzBjypxJs6bNmzgJBgQAIfkEBQQAAAAsAgACAAQABACCAAAA/wAAAAD/AKAA/9wA////gICAQEBACAkAAwgcSLBggIAAIfkEBQQAAAAsAAAAACgAKACCAAAA/wAAAAD/AKAA/9wA////gICAQEBACIsAAwgcSLCgwYMICQpYyLChw4cQIzYcQLGixYsYM2q0mLCjx44SQ4oMubGkyZIfU6oMMLKlSwEnY8ocsLJmwpc4Jc7cudGmz4I5gzrkSfTiz6MshSotypQmUp9KlzYl+hRq1KBTqVateRVr1p1buXbF+RVsWJVjyZaVeRZtWpdr2bb9+BZu3JNzPwYEADs='
/** 8×8, no transparency: a green frame, then a yellow one */
const OPAQUE = 'R0lGODlhCAAIAIIAAAAAAP8AAAAA/wCgAP/cAP///4CAgEBAQCH/C05FVFNDQVBFMi4wAwEAAAAh+QQABAAAACwAAAAACAAIAAAIDwAHCBxIsKDBgwgTKkwYEAAh+QQABAAAACwAAAAACAAIAIIAAAD/AAAAAP8AoAD/3AD///+AgIBAQEAIDwAJCBxIsKDBgwgTKkwYEAA7'
/** 16×16: a red 10×10 square that is cleared after its frame (disposal 2), then a blue 2×2 at (12, 12) */
const CLEARED = 'R0lGODlhEAAQAIIAAAAAAP8AAAAA/wCgAP/cAP///4CAgEBAQCH/C05FVFNDQVBFMi4wAwEAAAAh+QQJBAAAACwAAAAAEAAQAAAIMwADCBxIEIDBgwQTBjiIUOFAhgYdPoQoUSBEABUXUqx4MWNHjhslXhxJsqTJkyhTqkQZEAAh+QQFBAAAACwMAAwAAgACAIIAAAD/AAAAAP8AoAD/3AD///+AgIBAQEAIBgAFCBQQEAA7'

const bytes = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0))
const RED = [255, 0, 0, 255]
const BLUE = [0, 0, 255, 255]
const GREEN = [0, 160, 0, 255]
const NONE = [0, 0, 0, 0]

function pixel(frame: NonNullable<ReturnType<typeof gif_fullest_frame>>, x: number, y: number) {
	const at = (y * frame.width + x) * 4
	return Array.from(frame.rgba.subarray(at, at + 4))
}

describe('the frame of a GIF a still card shows', () => {
	test('an animation that starts empty shows its fullest frame, its rows in place though interlaced', () => {
		const frame = gif_fullest_frame(bytes(BLANK_START))!
		expect({ w: frame.width, h: frame.height }).toEqual({ w: 40, h: 40 })
		expect(pixel(frame, 0, 0)).toEqual(RED)
		expect(pixel(frame, 0, 1)).toEqual(BLUE)
		expect(pixel(frame, 0, 2)).toEqual(GREEN)
		expect(pixel(frame, 39, 37)).toEqual(BLUE)
	})

	test('a GIF without transparency keeps its first frame', () => {
		const frame = gif_fullest_frame(bytes(OPAQUE))!
		expect(pixel(frame, 0, 0)).toEqual(GREEN)
		expect(pixel(frame, 7, 7)).toEqual(GREEN)
	})

	test('a frame that clears itself is gone from the next one', () => {
		const frame = gif_fullest_frame(bytes(CLEARED))!
		// the red square alone is fuller than the blue dot alone
		expect(pixel(frame, 5, 5)).toEqual(RED)
		expect(pixel(frame, 12, 12)).toEqual(NONE)
	})

	test('anything but a GIF, or a cut one, gives nothing or what could be read', () => {
		expect(gif_fullest_frame(new TextEncoder().encode('%PDF-1.4'))).toBeNull()
		expect(gif_fullest_frame(new Uint8Array())).toBeNull()
		const cut = bytes(BLANK_START).subarray(0, 200)
		expect(() => gif_fullest_frame(cut)).not.toThrow()
	})

	test('a long GIF stops at its budget with the fullest frame so far', () => {
		// a budget of one frame: the empty first frame is all there is
		const frame = gif_fullest_frame(bytes(BLANK_START), 1)!
		expect(pixel(frame, 0, 0)).toEqual(NONE)
	})
})

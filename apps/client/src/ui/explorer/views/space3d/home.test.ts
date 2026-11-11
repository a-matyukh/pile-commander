import { describe, expect, test } from 'vitest'
import { MIN_HOME_SCALE, px_per_unit, start_frame, type View } from './home'

const DEG = Math.PI / 180
const U = 0.01
const PHI = 50 * DEG
const desktop: View = { fov: 35 * DEG, aspect: 1200 / 700, height: 700 }
const phone: View = { fov: 35 * DEG, aspect: 375 / 700, height: 700 }
const min_px = MIN_HOME_SCALE / U

/** Where the top and bottom of the view meet the floor, from a frame */
function floor_span(frame: { z: number; radius: number }, view: View) {
	const half = view.fov / 2
	const height = frame.radius * Math.cos(PHI)
	const ahead = frame.radius * Math.sin(PHI)
	return { top: frame.z - (height * Math.tan(PHI + half) - ahead), bottom: frame.z + (ahead - height * Math.tan(PHI - half)) }
}

describe('where the camera starts in a folder too large to show whole', () => {
	test('it is as close as makes a board px the smallest readable size', () => {
		const frame = start_frame({ x0: 0, z0: 0, x1: 9, z1: 170 }, desktop, PHI, min_px)
		expect(px_per_unit(desktop, frame.radius) * U).toBeCloseTo(MIN_HOME_SCALE)
	})

	test('a long column of files starts at its top rows, centered across', () => {
		const layout = { x0: -0.8, z0: -0.8, x1: 9.6, z1: 171 }
		const frame = start_frame(layout, desktop, PHI, min_px)
		expect(frame.x).toBeCloseTo((layout.x0 + layout.x1) / 2)
		expect(floor_span(frame, desktop).top).toBeCloseTo(layout.z0)
	})

	test('rows wider than a phone held upright start at the left', () => {
		const layout = { x0: 0, z0: 0, x1: 30, z1: 12 }
		const frame = start_frame(layout, phone, PHI, min_px)
		const across = frame.radius * Math.tan(phone.fov / 2) * phone.aspect
		expect(frame.x - across).toBeCloseTo(layout.x0)
		// shallow enough to fit up and down: its middle in the middle of the view, as a whole folder's
		const span = floor_span(frame, phone)
		expect(span.top).toBeLessThan(layout.z0)
		expect(span.bottom).toBeGreaterThan(layout.z1)
		expect(frame.z).toBeCloseTo((layout.z0 + layout.z1) / 2)
	})
})

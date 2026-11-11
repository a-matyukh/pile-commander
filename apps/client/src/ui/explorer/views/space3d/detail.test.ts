import { describe, expect, test } from 'vitest'
import { FACE_SCALES, plan_detail, scale_for, start_scale, type FaceState } from './detail'

/** A w×h board px face at `scale`, wanting `wanted`, `distance` from the camera */
function face(name: string, o: { w?: number; h?: number; scale: number; wanted: number; distance: number }): FaceState & { name: string } {
	const w = o.w ?? 200
	const h = o.h ?? 100
	const texels_at = (s: number) => Math.round(w * s) * Math.round(h * s)
	return { name, texels: texels_at(o.scale), texels_at, scale: o.scale, wanted: o.wanted, distance: o.distance }
}

const names = (plan: { face: { name: string }; scale: number }[]) => plan.map(step => `${step.face.name}→${step.scale}`)

describe('how sharp a face is drawn', () => {
	test('as sharp as it is on screen, in steps, a little coarser allowed', () => {
		expect(scale_for(0)).toBe(0.5)
		expect(scale_for(0.6)).toBe(0.5)
		expect(scale_for(1.2)).toBe(1)
		expect(scale_for(1.4)).toBe(2)
		expect(scale_for(2.4)).toBe(2)
		expect(scale_for(3.6)).toBe(3)
		// right up close it stays at the sharpest step
		expect(scale_for(12)).toBe(FACE_SCALES[FACE_SCALES.length - 1])
	})

	test('a small folder starts as sharp as before; a big one starts coarser, within half the budget', () => {
		const budget = 32e6
		const card = 200 * 140
		expect(start_scale(10 * card, 0, budget)).toBe(3)
		const big = 300 * card
		const scale = start_scale(big, 0, budget)
		expect(scale).toBe(1)
		expect(big * scale ** 2).toBeLessThanOrEqual(budget / 2)
		// with the budget already spent, new faces start at the coarsest
		expect(start_scale(card, budget, budget)).toBe(0.5)
	})
})

describe('what is drawn again', () => {
	test('faces that should be sharper get it nearest first; with room to spare none is made coarser', () => {
		const plan = plan_detail([
			face('far', { scale: 1, wanted: 3, distance: 9 }),
			face('near', { scale: 1, wanted: 3, distance: 1 }),
			face('oversized', { scale: 3, wanted: 0.5, distance: 20 }),
		], 1e9)
		expect(names(plan)).toEqual(['near→3', 'far→3'])
	})

	test('when the sharper faces would not fit, the farthest oversized ones give way first', () => {
		// each 200×100 face: 20 000 texels at 1, 180 000 at 3, 5 000 at 0.5
		const faces = [
			face('near', { scale: 1, wanted: 3, distance: 1 }),
			face('off screen, close', { scale: 3, wanted: 0.5, distance: 5 }),
			face('off screen, far', { scale: 3, wanted: 0.5, distance: 30 }),
		]
		// now 380 000; the near one adds 160 000; the budget leaves room for one to give way
		const plan = plan_detail(faces, 400_000)
		expect(names(plan)).toEqual(['off screen, far→0.5', 'near→3'])
	})

	test('a sharper face that does not fit even then waits; nearer ones still get theirs', () => {
		const faces = [
			face('near', { scale: 1, wanted: 2, distance: 1 }),
			face('farther', { scale: 1, wanted: 3, distance: 4 }),
		]
		// 40 000 now; "near" adds 60 000, "farther" would add 160 000
		expect(names(plan_detail(faces, 120_000))).toEqual(['near→2'])
	})
})

/**
 * How sharp card faces are drawn. A face is drawn at a scale (canvas px per
 * board px) that matches how large it is on screen, in a few steps, and all
 * faces together stay within a budget of canvas pixels: a folder of hundreds
 * of files must not run the GPU, or a phone, out of memory. Up close a card
 * is as sharp as before; far away it costs a fraction.
 */

/** The scales a face may have, sharpest last */
export const FACE_SCALES = [0.5, 1, 2, 3]

/** A face may be this much coarser than the screen before it is drawn sharper */
const SLACK = 0.8

/** The scale for a face seen at `screen` device px per board px; 0: not on screen */
export function scale_for(screen: number): number {
	const need = screen * SLACK
	return FACE_SCALES.find(s => s >= need) ?? FACE_SCALES[FACE_SCALES.length - 1]
}

/**
 * The sharpest scale new faces of `area` board px² may start at: they take
 * at most half of what the budget has left, the rest is for sharpening later
 */
export function start_scale(area: number, used: number, budget: number): number {
	const room = budget / 2 - used
	for (let i = FACE_SCALES.length - 1; i > 0; i--) if (area * FACE_SCALES[i] ** 2 <= room) return FACE_SCALES[i]
	return FACE_SCALES[0]
}

export type FaceState = {
	/** Canvas pixels now */
	texels: number
	/** Canvas pixels at a scale */
	texels_at(scale: number): number
	scale: number
	/** The scale it should have now */
	wanted: number
	/** From the camera: nearer faces are sharpened first, farther ones give way first */
	distance: number
}

/**
 * What to draw again, in order. Faces that should be sharper get it nearest
 * first while everything fits the budget. When it would not fit, the
 * farthest faces sharper than they need to be are drawn coarser first; with
 * room to spare no face is made coarser, so nothing is redrawn for nothing.
 */
export function plan_detail<T extends FaceState>(faces: readonly T[], budget: number): { face: T; scale: number }[] {
	let total = 0
	const up: T[] = []
	const down: T[] = []
	for (const face of faces) {
		total += face.texels
		if (face.wanted > face.scale) up.push(face)
		else if (face.wanted < face.scale) down.push(face)
	}
	up.sort((a, b) => a.distance - b.distance)
	down.sort((a, b) => b.distance - a.distance)
	const growth = up.reduce((sum, face) => sum + face.texels_at(face.wanted) - face.texels, 0)
	const plan: { face: T; scale: number }[] = []
	for (const face of down) {
		if (total + growth <= budget) break
		total += face.texels_at(face.wanted) - face.texels
		plan.push({ face, scale: face.wanted })
	}
	for (const face of up) {
		const grow = face.texels_at(face.wanted) - face.texels
		if (total + grow > budget) continue
		total += grow
		plan.push({ face, scale: face.wanted })
	}
	return plan
}

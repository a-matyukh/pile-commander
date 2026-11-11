/**
 * Where the camera starts. The whole folder, as in the prototype, unless its
 * cards would come out too small to make out (hundreds of files, a phone
 * held upright): then it starts at the folder's beginning, its top rows,
 * from the left when they are wider than the view, as the board opens at
 * its top-left. "From above" still shows the whole folder.
 */

/** The whole folder is shown when a board px is at least this many CSS px on screen: a 200 px card is then 80 px */
export const MIN_HOME_SCALE = 0.4

/** `fov`: vertical, radians; `height`: CSS px */
export type View = { fov: number; aspect: number; height: number }

/** CSS px per scene unit at the center of the view, `radius` from the camera */
export function px_per_unit(view: View, radius: number): number {
	return view.height / (2 * Math.tan(view.fov / 2) * radius)
}

/**
 * The start of a layout too large to show whole, seen at `phi` from above
 * with `min_px` CSS px per unit at the target. The layout spans x0..x1 and
 * z0..z1 in scene units; z grows toward the camera, so its top rows (z0)
 * are at the top of the view. Each way it fits it is centered in the view,
 * as the whole folder is; where it does not, its top edge meets the top of
 * the view and its left edge the left
 */
export function start_frame(
	layout: { x0: number; z0: number; x1: number; z1: number },
	view: View,
	phi: number,
	min_px: number,
): { x: number; z: number; radius: number } {
	const half = view.fov / 2
	const radius = view.height / (2 * Math.tan(half) * min_px)
	const height = radius * Math.cos(phi)
	const ahead = radius * Math.sin(phi)
	// how far the floor shows beyond the target (the top of the view: never past the horizon) and before it (the bottom)
	const far = height * Math.tan(Math.min(phi + half, Math.PI / 2 - 0.05)) - ahead
	const near = ahead - height * Math.tan(Math.max(0, phi - half))
	const across = radius * Math.tan(half) * view.aspect
	const width = layout.x1 - layout.x0
	const depth = layout.z1 - layout.z0
	const x = width <= across * 2 ? (layout.x0 + layout.x1) / 2 : layout.x0 + across
	const z = depth <= far + near ? (layout.z0 + layout.z1) / 2 : layout.z0 + far
	return { x, z, radius }
}

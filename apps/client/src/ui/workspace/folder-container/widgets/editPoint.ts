/**
 * Where the double click (or double tap) that opened a note landed, so the
 * editor puts the caret there and not at the end. Kept briefly: the editor
 * mounts a frame or two after the gesture.
 */
type EditPoint = { x: number; y: number; at: number }

const KEEP_MS = 1500

let point: EditPoint | null = null

export function rememberEditPoint(x: number, y: number) {
	point = { x, y, at: Date.now() }
}

/** The point, once, if it is recent. */
export function takeEditPoint(): { x: number; y: number } | null {
	const found = point
	point = null
	if (!found || Date.now() - found.at > KEEP_MS) return null
	return { x: found.x, y: found.y }
}

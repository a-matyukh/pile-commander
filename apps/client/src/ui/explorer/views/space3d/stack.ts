/**
 * How high cards float when no height was set for them in 3D. As on the
 * board, a later card lies over the earlier cards it overlaps: it floats a
 * step above the highest of them, so two overlapping cards never share a
 * height (they would flicker through each other). Models stand on the floor;
 * a height set in 3D is kept.
 */

/** Board px: a card just over the floor; a step over the cards it covers; the tallest a default stack grows */
export const CARD_HEIGHT = 14
const STACK_STEP = 6
const STACK_MAX = 60

type Box = { key: string; kind: string; x: number; y: number; w: number; h: number; z: number | null }

const overlaps = (a: Box, b: Box) =>
	Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 4 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 4

/**
 * The height of each item's bottom, board px. A long chain of overlapping
 * cards (hundreds of files on the board's default grid) keeps its order in
 * smaller steps, so the stack stays low instead of rising into a staircase
 */
export function card_heights(items: readonly Box[]): Map<string, number> {
	const level: (number | undefined)[] = []
	let deepest = 0
	items.forEach((it, i) => {
		if (it.z !== null || it.kind === 'model') return
		let l = 0
		for (let j = 0; j < i; j++) {
			const below = level[j]
			if (below !== undefined && below >= l && overlaps(items[j], it)) l = below + 1
		}
		level[i] = l
		deepest = Math.max(deepest, l)
	})
	const step = deepest ? Math.min(STACK_STEP, STACK_MAX / deepest) : STACK_STEP
	const out = new Map<string, number>()
	items.forEach((it, i) => out.set(it.key, it.z ?? (it.kind === 'model' ? 0 : CARD_HEIGHT + step * (level[i] ?? 0))))
	return out
}

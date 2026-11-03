/**
 * Stack order of a board or canvas: index 0 is the back, the last id is the
 * front. `moving` keeps its relative order. A step that would not change
 * the order returns null.
 */
export type LayerStep = 'front' | 'forward' | 'backward' | 'back'

export function layer_order(
	ids: readonly string[],
	moving: readonly string[],
	step: LayerStep,
): string[] | null {
	const present = new Set(ids)
	const move = new Set(moving.filter(id => present.has(id)))
	if (move.size === 0) return null

	if (step === 'front' || step === 'back') {
		const block = ids.filter(id => move.has(id))
		const rest = ids.filter(id => !move.has(id))
		const next = step === 'front' ? [...rest, ...block] : [...block, ...rest]
		return same(ids, next) ? null : next
	}

	const next = ids.slice()
	if (step === 'forward') {
		for (let i = next.length - 2; i >= 0; i--) {
			if (move.has(next[i]!) && !move.has(next[i + 1]!)) {
				const swapped = next[i]!
				next[i] = next[i + 1]!
				next[i + 1] = swapped
			}
		}
	} else {
		for (let i = 1; i < next.length; i++) {
			if (move.has(next[i]!) && !move.has(next[i - 1]!)) {
				const swapped = next[i]!
				next[i] = next[i - 1]!
				next[i - 1] = swapped
			}
		}
	}
	return same(ids, next) ? null : next
}

/** `]` / `[` jump to an edge; ⌘ or Ctrl steps one layer. Shift and Alt do not. */
export function layer_step_from_key(event: {
	code: string
	metaKey: boolean
	ctrlKey: boolean
	altKey: boolean
	shiftKey: boolean
}): LayerStep | null {
	if (event.altKey || event.shiftKey) return null
	if (event.code !== 'BracketLeft' && event.code !== 'BracketRight') return null
	const command = event.metaKey || event.ctrlKey
	if (event.code === 'BracketRight') return command ? 'forward' : 'front'
	return command ? 'backward' : 'back'
}

function same(a: readonly string[], b: readonly string[]): boolean {
	return a.length === b.length && a.every((id, index) => id === b[index])
}

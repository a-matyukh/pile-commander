import type { Size } from '@/domain/Widget'

export type GroupResizeMember = {
	id: string
	size: Size
}

/**
 * Grow/shrink every member by the same pixel delta, clamped to minSize.
 * Snap / min-size modifiers belong on the primary only — the delta it ends
 * up with is already constrained, companions just follow it.
 */
export function applyGroupResizeDelta(
	starts: Record<string, Size>,
	delta: Size,
	minSize: Size,
): Record<string, Size> {
	const next: Record<string, Size> = {}
	for (const [id, start] of Object.entries(starts)) {
		next[id] = {
			width: Math.max(minSize.width, start.width + delta.width),
			height: Math.max(minSize.height, start.height + delta.height),
		}
	}
	return next
}

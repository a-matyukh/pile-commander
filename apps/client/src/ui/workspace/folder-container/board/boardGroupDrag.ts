import type { Position } from '@/domain/Widget'

export type GroupDragMember = {
	id: string
	position: Position
}

/**
 * Translate every member by the same delta. Snap / origin-clamp belong on the
 * primary only — applying them per-member jumps companions onto the grid or
 * toward (0,0) at drag start.
 */
export function applyGroupDragDelta(
	starts: Record<string, Position>,
	delta: Position,
): Record<string, Position> {
	const next: Record<string, Position> = {}
	for (const [id, start] of Object.entries(starts)) {
		next[id] = {
			x: start.x + delta.x,
			y: start.y + delta.y,
		}
	}
	return next
}

/**
 * Map a multi-drag into a folder's coordinate space.
 *
 * `primaryRelative` is where the grabbed widget lands inside the folder.
 * `memberStarts` must be the group's positions at drag seed (or any snapshot
 * where every member shares the same translation) — companions keep
 * start-offset from the primary so layout survives even if a companion's live
 * drag position was not updated.
 */
export function relativePositionsForFolderDrop(
	primaryId: string,
	primaryRelative: Position,
	memberStarts: Record<string, Position>,
): Record<string, Position> {
	const primaryStart = memberStarts[primaryId]
	const result: Record<string, Position> = { [primaryId]: { ...primaryRelative } }
	if (!primaryStart) return result

	for (const [id, start] of Object.entries(memberStarts)) {
		if (id === primaryId) continue
		result[id] = {
			x: primaryRelative.x + (start.x - primaryStart.x),
			y: primaryRelative.y + (start.y - primaryStart.y),
		}
	}
	return result
}

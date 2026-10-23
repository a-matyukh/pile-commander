/**
 * Board rule for Vue Flow's getDragItems.
 * Companions move only when the grabbed node is already part of a 2+ selection.
 * Otherwise only that node moves, and the existing selection stays put.
 */

export type SoloDragNode = {
	id: string
	selected?: boolean
	draggable?: boolean
}

/** Previous `draggable` flags for nodes a solo drag temporarily turned off. */
export type DraggableSnapshot = Map<string, boolean | undefined>

export function draggedNodeParticipatesInGroup(
	primaryId: string,
	nodes: readonly { id: string; selected?: boolean }[],
): boolean {
	let selectedCount = 0
	let primarySelected = false
	for (const node of nodes) {
		if (!node.selected) continue
		selectedCount += 1
		if (node.id === primaryId) primarySelected = true
	}
	return primarySelected && selectedCount >= 2
}

/**
 * Keep the grabbed node draggable and clear `draggable` on every other selected
 * node so getDragItems skips them. Unselected nodes are left alone: Vue Flow
 * only pulls them in when they are the node under the pointer.
 */
export function lockSoloDrag<T extends SoloDragNode>(
	nodes: readonly T[],
	primaryId: string,
): DraggableSnapshot {
	const saved: DraggableSnapshot = new Map()
	for (const node of nodes) {
		if (node.id === primaryId || !node.selected) continue
		saved.set(node.id, node.draggable)
		node.draggable = false
	}
	return saved
}

export function restoreDraggable<T extends SoloDragNode>(
	nodes: readonly T[],
	saved: DraggableSnapshot,
) {
	for (const node of nodes) {
		if (!saved.has(node.id)) continue
		node.draggable = saved.get(node.id)
	}
}

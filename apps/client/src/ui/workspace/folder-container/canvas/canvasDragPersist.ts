import type { Position } from '@/domain/Widget'

export type CanvasDragPositionSnapshot = {
	id: string
	position: Position
}

type DragNodeLike = {
	id: string
	type?: string
	position: Position
}

/**
 * Copy positions off Vue Flow graph nodes before any async work.
 * VF `setNodes` / Object.assign can mutate the live node objects while we
 * still await sequential `change_position` calls.
 */
export function snapshotWidgetDragPositions(
	nodes: DragNodeLike[],
): CanvasDragPositionSnapshot[] {
	const snapshots: CanvasDragPositionSnapshot[] = []
	for (const node of nodes) {
		if (node.type === 'stroke') continue
		snapshots.push({
			id: node.id,
			position: { x: node.position.x, y: node.position.y },
		})
	}
	return snapshots
}

export async function persistDragPositionSnapshots(
	snapshots: CanvasDragPositionSnapshot[],
	changePosition: (id: string, position: Position) => Promise<void>,
): Promise<void> {
	for (const snapshot of snapshots) {
		await changePosition(snapshot.id, snapshot.position)
	}
}

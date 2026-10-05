import { describe, expect, test } from 'vitest'
import {
	persistDragPositionSnapshots,
	snapshotWidgetDragPositions,
} from './canvasDragPersist'

describe('snapshotWidgetDragPositions', () => {
	test('copies positions and skips strokes', () => {
		const nodes = [
			{ id: 'a', type: 'folderWidget', position: { x: 1, y: 2 } },
			{ id: 's', type: 'stroke', position: { x: 9, y: 9 } },
			{ id: 'b', position: { x: 3, y: 4 } },
		]
		const snapshots = snapshotWidgetDragPositions(nodes)
		expect(snapshots).toEqual([
			{ id: 'a', position: { x: 1, y: 2 } },
			{ id: 'b', position: { x: 3, y: 4 } },
		])

		// Mutating the source must not change the snapshot.
		nodes[0]!.position.x = 100
		expect(snapshots[0]!.position).toEqual({ x: 1, y: 2 })
	})
})

describe('persistDragPositionSnapshots', () => {
	test('persists snapshot coords even if live nodes are mutated mid-flight', async () => {
		const live = [
			{ id: 'a', position: { x: 10, y: 20 } },
			{ id: 'b', position: { x: 30, y: 40 } },
		]
		const snapshots = snapshotWidgetDragPositions(live)
		const persisted: Array<{ id: string; position: { x: number; y: number } }> = []

		await persistDragPositionSnapshots(snapshots, async (id, position) => {
			persisted.push({ id, position: { ...position } })
			// Simulate Vue Flow setNodes Object.assign-mutating remaining live nodes
			// after the first persist (the race that used to roll back multi-drag).
			if (id === 'a') {
				live[1]!.position = { x: 0, y: 0 }
			}
		})

		expect(persisted).toEqual([
			{ id: 'a', position: { x: 10, y: 20 } },
			{ id: 'b', position: { x: 30, y: 40 } },
		])
		expect(live[1]!.position).toEqual({ x: 0, y: 0 })
	})
})

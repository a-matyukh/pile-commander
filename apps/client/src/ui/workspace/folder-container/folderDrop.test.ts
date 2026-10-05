import { describe, expect, test } from 'vitest'
import {
	droppableWidgetIds,
	isSameBoardFolderDropTarget,
	type ContainsHost,
} from './folderDrop'

type FakeNode = ContainsHost & { id: string }

function node(id: string, descendantIds: string[] = []): FakeNode {
	const owned = new Set([id, ...descendantIds])
	return {
		id,
		contains(value: unknown) {
			if (typeof value !== 'object' || value === null || !('id' in value)) {
				return false
			}
			const otherId = (value as FakeNode).id
			return otherId !== id && owned.has(otherId)
		},
	}
}

describe('isSameBoardFolderDropTarget', () => {
	const notesBoard = { id: 'notes-board' }
	const ideasBoard = { id: 'ideas-board' }

	test('accepts a sibling folder on the same board', () => {
		const dragged = node('ideas-preview')
		const sibling = node('todo-cover')
		expect(isSameBoardFolderDropTarget(dragged, sibling, notesBoard, notesBoard)).toBe(true)
	})

	test('rejects a FolderCover inside the dragged preview', () => {
		const childCover = node('ideas-child-cover')
		const dragged = node('ideas-preview', ['ideas-child-cover'])
		expect(
			isSameBoardFolderDropTarget(dragged, childCover, notesBoard, ideasBoard),
		).toBe(false)
	})

	test('rejects a nested folder inside a neighbor preview', () => {
		const dragged = node('ideas-preview')
		const nested = node('notes-child-cover')
		expect(
			isSameBoardFolderDropTarget(dragged, nested, notesBoard, ideasBoard),
		).toBe(false)
	})

	test('rejects the dragged folder itself', () => {
		const dragged = node('ideas-preview')
		expect(isSameBoardFolderDropTarget(dragged, dragged, notesBoard, notesBoard)).toBe(false)
	})

	test('rejects a folder that contains the dragged widget', () => {
		const dragged = node('file')
		const parent = node('parent-preview', ['file'])
		expect(
			isSameBoardFolderDropTarget(dragged, parent, notesBoard, notesBoard),
		).toBe(false)
	})
})

describe('droppableWidgetIds', () => {
	test('removes the target folder from the drop set', () => {
		expect(droppableWidgetIds(['/a', '/folder', '/b'], '/folder')).toEqual([
			'/a',
			'/b',
		])
	})

	test('keeps the list unchanged when target is not selected', () => {
		expect(droppableWidgetIds(['/a', '/b'], '/folder')).toEqual(['/a', '/b'])
	})

	test('removes a folder when the target is its descendant', () => {
		expect(droppableWidgetIds(['/notes', '/todo'], '/notes/ideas')).toEqual(['/todo'])
	})
})

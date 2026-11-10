import { describe, expect, test } from 'vitest'
import {
	droppableWidgetIds,
	eventClientPoint,
	findDropFolder,
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

describe('findDropFolder', () => {
	type Rect = { left: number; top: number; right: number; bottom: number; width: number; height: number }
	function rect(left: number, top: number, width: number, height: number): Rect {
		return { left, top, width, height, right: left + width, bottom: top + height }
	}

	// A big note dragged so the cursor is over a folder while its centre is not.
	function board() {
		const section = {} as Record<string, unknown>
		const folder = {
			getBoundingClientRect: () => rect(0, 0, 200, 150),
			closest: () => section,
			contains: (other: unknown) => other === folder,
		}
		const note = {
			getBoundingClientRect: () => rect(150, 100, 600, 500),
			closest: () => section,
			contains: (other: unknown) => other === note,
		}
		section.querySelectorAll = () => [folder]
		return { folder, note: note as unknown as HTMLElement }
	}

	test('the folder under the pointer is the target, wherever the dragged note\'s centre is', () => {
		const { folder, note } = board()
		expect(findDropFolder(note, { x: 160, y: 110 })).toBe(folder)
	})

	test('without a pointer the centre decides', () => {
		const { note } = board()
		expect(findDropFolder(note)).toBeNull()
	})

	test('a pointer off the folder drops nowhere', () => {
		const { note } = board()
		expect(findDropFolder(note, { x: 400, y: 400 })).toBeNull()
	})
})

describe('eventClientPoint', () => {
	test('a mouse event and a touch end give the pointer', () => {
		expect(eventClientPoint({ clientX: 3, clientY: 4 } as MouseEvent)).toEqual({ x: 3, y: 4 })
		expect(eventClientPoint({ changedTouches: [{ clientX: 5, clientY: 6 }], touches: [] } as unknown as TouchEvent))
			.toEqual({ x: 5, y: 6 })
	})
})

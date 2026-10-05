import { describe, expect, it } from 'vitest'
import { isEmptyBoardPointerTarget } from './isEmptyBoardPointerTarget'

type FakeNode = {
	id: string
	closest(selector: string): FakeNode | null
}

function createTree() {
	const nodes = new Map<string, FakeNode>()
	const parentOf = new Map<string, string | null>()
	const descendants = new Map<string, Set<string>>()

	function node(id: string): FakeNode {
		const existing = nodes.get(id)
		if (existing) return existing
		const created: FakeNode = {
			id,
			closest(selector: string) {
				if (selector !== '.board-widget') return null
				let current: string | null = id
				while (current) {
					if (current.startsWith('widget:')) return node(current)
					current = parentOf.get(current) ?? null
				}
				return null
			},
		}
		nodes.set(id, created)
		descendants.set(id, new Set([id]))
		return created
	}

	function adopt(parentId: string, childId: string) {
		parentOf.set(childId, parentId)
		let current: string | null = parentId
		while (current) {
			descendants.get(current)?.add(childId)
			current = parentOf.get(current) ?? null
		}
	}

	function containsHost(id: string) {
		const owned = descendants.get(id) ?? new Set([id])
		return {
			contains(value: unknown) {
				if (typeof value !== 'object' || value === null || !('id' in value)) {
					return false
				}
				return owned.has((value as FakeNode).id)
			},
		}
	}

	return { node, adopt, containsHost }
}

describe('isEmptyBoardPointerTarget', () => {
	it('treats empty pane inside an ancestor folder-preview widget as empty', () => {
		const tree = createTree()
		const preview = tree.node('widget:preview')
		const board = tree.node('board')
		const pane = tree.node('pane')
		tree.adopt('widget:preview', 'board')
		tree.adopt('board', 'pane')

		expect(pane.closest('.board-widget')).toBe(preview)
		expect(isEmptyBoardPointerTarget(pane, tree.containsHost('board'))).toBe(true)
	})

	it('rejects a child .board-widget of this board', () => {
		const tree = createTree()
		tree.node('board')
		const child = tree.node('widget:child')
		tree.adopt('board', 'widget:child')

		expect(isEmptyBoardPointerTarget(child, tree.containsHost('board'))).toBe(false)
	})

	it('rejects a click outside boardRef', () => {
		const tree = createTree()
		tree.node('board')
		const outside = tree.node('outside')

		expect(isEmptyBoardPointerTarget(outside, tree.containsHost('board'))).toBe(false)
	})

	it('rejects null target or board', () => {
		const tree = createTree()
		const board = tree.containsHost('board')
		const pane = tree.node('pane')

		expect(isEmptyBoardPointerTarget(null, board)).toBe(false)
		expect(isEmptyBoardPointerTarget(pane, null)).toBe(false)
	})
})

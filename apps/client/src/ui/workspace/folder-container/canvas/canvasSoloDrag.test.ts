import { describe, expect, test } from 'vitest'
import {
	draggedNodeParticipatesInGroup,
	lockSoloDrag,
	restoreDraggable,
	type SoloDragNode,
} from './canvasSoloDrag'

function node(id: string, selected = false, draggable = true): SoloDragNode {
	return { id, selected, draggable }
}

describe('draggedNodeParticipatesInGroup', () => {
	test('a second widget dragged while one is selected is not a group', () => {
		const nodes = [node('a', true), node('b')]
		expect(draggedNodeParticipatesInGroup('b', nodes)).toBe(false)
	})

	test('dragging one of two selected widgets is a group', () => {
		const nodes = [node('a', true), node('b', true)]
		expect(draggedNodeParticipatesInGroup('a', nodes)).toBe(true)
	})

	test('dragging a third widget while two are selected is not a group', () => {
		const nodes = [node('a', true), node('b', true), node('c')]
		expect(draggedNodeParticipatesInGroup('c', nodes)).toBe(false)
	})

	test('a selected widget and a selected stroke count as a group', () => {
		const nodes = [node('widget', true), node('stroke', true)]
		expect(draggedNodeParticipatesInGroup('widget', nodes)).toBe(true)
		expect(draggedNodeParticipatesInGroup('stroke', nodes)).toBe(true)
	})

	test('the only selected node is not a group', () => {
		const nodes = [node('a', true), node('b')]
		expect(draggedNodeParticipatesInGroup('a', nodes)).toBe(false)
	})
})

describe('lockSoloDrag', () => {
	test('turns off draggable on the other selected node and leaves the grabbed one', () => {
		const nodes = [node('a', true), node('b'), node('c', false, false)]
		const saved = lockSoloDrag(nodes, 'b')
		expect(nodes.map(n => n.draggable)).toEqual([false, true, false])
		expect(saved.get('a')).toBe(true)
		expect(saved.has('b')).toBe(false)
		expect(saved.has('c')).toBe(false)
	})

	test('locks every selected companion when a third node is dragged', () => {
		const nodes = [node('a', true), node('b', true), node('c')]
		lockSoloDrag(nodes, 'c')
		expect(nodes.map(n => n.draggable)).toEqual([false, false, true])
	})

	test('restoreDraggable puts the flags back', () => {
		const nodes = [node('a', true, true), node('stroke', true, true), node('b')]
		const saved = lockSoloDrag(nodes, 'b')
		restoreDraggable(nodes, saved)
		expect(nodes.map(n => n.draggable)).toEqual([true, true, true])
	})
})

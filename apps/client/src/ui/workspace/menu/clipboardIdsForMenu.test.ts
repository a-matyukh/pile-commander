import { describe, expect, test } from 'vitest'
import type { WorkspaceStore } from '@/domain/Store'
import { clipboardIdsForMenu } from './clipboardIdsForMenu'

function ws(selection: string[], childIds: string[]): WorkspaceStore {
	return {
		selection,
		is_selected: (id: string) => selection.includes(id),
		opened_folder: {
			children: childIds.map(id => ({ id })),
		},
	} as unknown as WorkspaceStore
}

const node = { id: 'a', name: 'a.txt', type: 'file' as const }

describe('clipboardIdsForMenu', () => {
	test('returns the menu node when it is not part of a multi-selection', () => {
		expect(clipboardIdsForMenu(node, ws([], ['a', 'b']))).toEqual(['a'])
		expect(clipboardIdsForMenu(node, ws(['a'], ['a', 'b']))).toEqual(['a'])
		expect(clipboardIdsForMenu(node, ws(['b', 'c'], ['a', 'b', 'c']))).toEqual(['a'])
	})

	test('returns selected pane children when the menu node is among them', () => {
		expect(clipboardIdsForMenu(node, ws(['a', 'c'], ['a', 'b', 'c']))).toEqual(['a', 'c'])
	})

	test('uses explicit children over opened_folder (nested folder preview)', () => {
		const store = ws(['a', 'nested'], ['a', 'b'])
		expect(clipboardIdsForMenu(node, store, [{ id: 'a' }, { id: 'nested' }])).toEqual([
			'a',
			'nested',
		])
	})
})

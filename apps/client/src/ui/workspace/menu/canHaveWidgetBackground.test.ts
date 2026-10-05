import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import {
	canHaveWidgetBackground,
	selectionCanSetSharedBackground,
} from './canHaveWidgetBackground'

function file(
	name: string,
	extra: Partial<Extract<FolderContainerWidgetChild, { type: 'file' }>> = {},
): FolderContainerWidgetChild {
	return {
		id: `/ws/${name}`,
		name,
		type: 'file',
		is_preview: true,
		...extra,
	}
}

describe('canHaveWidgetBackground', () => {
	test('allows preview notes and media', () => {
		expect(canHaveWidgetBackground(file('a.txt'))).toBe(true)
		expect(canHaveWidgetBackground(file('readme.md'))).toBe(true)
		expect(canHaveWidgetBackground(file('pic.png'))).toBe(true)
		expect(canHaveWidgetBackground(file('clip.mp4'))).toBe(true)
		expect(canHaveWidgetBackground(file('track.mp3'))).toBe(true)
		expect(canHaveWidgetBackground(file('mesh.glb'))).toBe(true)
	})

	test('rejects shapes, non-preview files, and folders', () => {
		expect(canHaveWidgetBackground(file('shape.svg'))).toBe(false)
		expect(canHaveWidgetBackground(file('a.txt', { is_preview: false }))).toBe(false)
		expect(canHaveWidgetBackground(file('doc.pdf', { is_preview: false }))).toBe(false)
		expect(canHaveWidgetBackground({
			id: '/ws/folder',
			name: 'folder',
			type: 'folder_container',
			view: 'list',
			children: [],
		})).toBe(false)
		expect(canHaveWidgetBackground({
			id: '/ws/cover',
			name: 'cover',
			type: 'folder_cover',
		})).toBe(false)
	})
})

describe('selectionCanSetSharedBackground', () => {
	test('requires every selected widget to support a background', () => {
		expect(selectionCanSetSharedBackground([file('a.txt')])).toBe(false)
		expect(selectionCanSetSharedBackground([file('a.txt'), file('b.md')])).toBe(true)
		expect(selectionCanSetSharedBackground([file('a.txt'), file('pic.png')])).toBe(true)
		expect(selectionCanSetSharedBackground([
			file('a.txt'),
			file('shape.svg'),
		])).toBe(false)
		expect(selectionCanSetSharedBackground([
			file('a.txt'),
			file('doc.pdf', { is_preview: false }),
		])).toBe(false)
	})
})

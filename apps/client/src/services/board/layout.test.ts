import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import {
	absolute_from_origin,
	board_content_extent,
	board_position,
	board_size,
	is_audio_widget,
	is_folder_preview_widget,
	is_image_widget,
	is_model_widget,
	is_note_widget,
	is_shape_widget,
	is_video_widget,
	NOTE_DEFAULT_SIZE,
	IMAGE_DEFAULT_SIZE,
	MODEL_DEFAULT_SIZE,
	SHAPE_SQUARE_DEFAULT_SIZE,
	SHAPE_LINE_DEFAULT_SIZE,
	FOLDER_PREVIEW_DEFAULT_SIZE,
	TILE,
	relative_to_origin,
	snap_position,
	top_left_position,
} from './layout'
import {
	get_file_extension,
	get_media_kind,
	get_mime_type,
	get_preview_toggle_label,
	is_previewable_file,
} from './media'

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

describe('media', () => {
	test('detects extension, kind and mime', () => {
		expect(get_file_extension('Photo.PNG')).toBe('.png')
		expect(get_media_kind('a.jpg')).toBe('image')
		expect(get_media_kind('a.mp4')).toBe('video')
		expect(get_media_kind('a.mp3')).toBe('audio')
		expect(get_media_kind('a.glb')).toBe('model')
		expect(get_media_kind('a.gltf')).toBe('model')
		expect(get_media_kind('a.txt')).toBeNull()
		expect(get_mime_type('a.webp')).toBe('image/webp')
		expect(get_mime_type('a.glb')).toBe('model/gltf-binary')
		expect(get_mime_type('a.bin')).toBe('application/octet-stream')
	})

	test('previewable files and toggle labels', () => {
		expect(is_previewable_file('a.txt')).toBe(true)
		expect(is_previewable_file('a.md')).toBe(true)
		expect(is_previewable_file('a.svg')).toBe(true)
		expect(is_previewable_file('a.png')).toBe(true)
		expect(is_previewable_file('a.glb')).toBe(true)
		expect(get_preview_toggle_label('a.svg', true)).toBe('Show as file')
		expect(get_preview_toggle_label('a.txt', false)).toBe('Preview')
		expect(get_preview_toggle_label('a.md', true)).toBe('Hide preview')
	})
})

describe('board layout', () => {
	test('widget type guards require preview flag', () => {
		expect(is_note_widget(file('a.txt'))).toBe(true)
		expect(is_note_widget(file('a.md'))).toBe(true)
		expect(is_note_widget(file('a.txt', { is_preview: false }))).toBe(false)
		expect(is_note_widget(file('a.md', { is_preview: false }))).toBe(false)
		expect(is_shape_widget(file('a.svg'))).toBe(true)
		expect(is_image_widget(file('a.png'))).toBe(true)
		expect(is_video_widget(file('a.mp4'))).toBe(true)
		expect(is_audio_widget(file('a.mp3'))).toBe(true)
		expect(is_model_widget(file('a.glb'))).toBe(true)
		expect(is_model_widget(file('a.glb', { is_preview: false }))).toBe(false)
		expect(is_folder_preview_widget({
			id: '/ws/f',
			name: 'f',
			type: 'folder_container',
			view: 'list',
			children: [],
		})).toBe(true)
	})

	test('board_position and board_size use defaults when unset', () => {
		expect(board_position(file('a.txt'), 0)).toEqual({ x: 20, y: 20 })
		expect(board_position(file('a.txt', { position: { x: 1, y: 2 } }), 0)).toEqual({ x: 1, y: 2 })
		expect(board_size(file('a.txt'))).toEqual(NOTE_DEFAULT_SIZE)
		expect(board_size(file('a.png'))).toEqual(IMAGE_DEFAULT_SIZE)
		expect(board_size(file('a.glb'))).toEqual(MODEL_DEFAULT_SIZE)
		expect(board_size(file('a.svg'))).toEqual(SHAPE_SQUARE_DEFAULT_SIZE)
		expect(board_size(file('Shape line.svg'))).toEqual(SHAPE_LINE_DEFAULT_SIZE)
		expect(board_size(file('a.txt', { size: { width: 9, height: 8 } }))).toEqual({
			width: 9,
			height: 8,
		})
	})

	test('board_content_extent returns zero for empty board', () => {
		expect(board_content_extent([])).toEqual({ minWidth: 0, minHeight: 0 })
	})

	test('board_content_extent covers default widget layout with padding', () => {
		const folderPreview = {
			id: '/ws/f',
			name: 'f',
			type: 'folder_container' as const,
			view: 'list' as const,
			children: [],
		}
		const children = [
			file('a.txt'),
			folderPreview,
			file('b.txt', { is_preview: false }),
		]

		const pos0 = board_position(children[0], 0)
		const pos1 = board_position(children[1], 1)
		const pos2 = board_position(children[2], 2)
		const size0 = board_size(children[0])
		const size1 = board_size(children[1])
		const size2 = board_size(children[2])

		const extent = board_content_extent(children)

		expect(extent.minWidth).toBe(
			Math.max(pos0.x + size0.width, pos1.x + size1.width, pos2.x + size2.width) + TILE.pad,
		)
		expect(extent.minHeight).toBe(
			Math.max(pos0.y + size0.height, pos1.y + size1.height, pos2.y + size2.height) + TILE.pad,
		)
		expect(extent.minWidth).toBe(pos1.x + FOLDER_PREVIEW_DEFAULT_SIZE.width + TILE.pad)
	})

	test('board_content_extent respects custom position, size, and drag overrides', () => {
		const widget = file('a.txt', {
			position: { x: 50, y: 60 },
			size: { width: 300, height: 400 },
		})

		expect(board_content_extent([widget])).toEqual({
			minWidth: 50 + 300 + TILE.pad,
			minHeight: 60 + 400 + TILE.pad,
		})

		expect(board_content_extent(
			[file('a.txt')],
			{ '/ws/a.txt': { x: 10, y: 20 } },
			{ '/ws/a.txt': { width: 150, height: 80 } },
		)).toEqual({
			minWidth: 10 + 150 + TILE.pad,
			minHeight: 20 + 80 + TILE.pad,
		})

		expect(board_content_extent([file('a.txt')]).minWidth).toBe(
			board_position(file('a.txt'), 0).x + NOTE_DEFAULT_SIZE.width + TILE.pad,
		)
	})
})

describe('spatial position helpers', () => {
	test('top_left_position picks topmost then leftmost', () => {
		expect(top_left_position([
			{ x: 100, y: 400 },
			{ x: 200, y: 450 },
		])).toEqual({ x: 100, y: 400 })

		expect(top_left_position([
			{ x: 200, y: 100 },
			{ x: 50, y: 100 },
		])).toEqual({ x: 50, y: 100 })

		expect(top_left_position([])).toBeUndefined()
	})

	test('relative_to_origin and absolute_from_origin are inverses', () => {
		const origin = { x: 100, y: 400 }
		const absolute = { x: 200, y: 450 }
		const relative = relative_to_origin(absolute, origin)

		expect(relative).toEqual({ x: 100, y: 50 })
		expect(absolute_from_origin(relative, origin)).toEqual(absolute)
	})

	test('relative_to_origin applies inset padding for combine', () => {
		const origin = { x: 100, y: 400 }
		const inset = { x: TILE.pad, y: TILE.pad }
		const relative = relative_to_origin({ x: 100, y: 400 }, origin, inset)
		const other = relative_to_origin({ x: 200, y: 450 }, origin, inset)

		expect(relative).toEqual({ x: 20, y: 20 })
		expect(other).toEqual({ x: 120, y: 70 })
		expect(absolute_from_origin(relative, origin, inset)).toEqual({ x: 100, y: 400 })
		expect(absolute_from_origin(other, origin, inset)).toEqual({ x: 200, y: 450 })
	})
})

describe('snap_position', () => {
	test('returns position unchanged when snap disabled', () => {
		expect(snap_position({ x: 13, y: 27 }, { enabled: false, size: 20 })).toEqual({
			x: 13,
			y: 27,
		})
	})

	test('rounds to grid when enabled', () => {
		expect(snap_position({ x: 13, y: 27 }, { enabled: true, size: 20 })).toEqual({
			x: 20,
			y: 20,
		})
	})
})

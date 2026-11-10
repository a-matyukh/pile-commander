import { describe, expect, test } from 'vitest'
import type { FolderContainerWidgetChild } from '@/domain/Widget'
import {
	absolute_from_origin,
	board_content_extent,
	board_quadrant_shift,
	off_board_children,
	board_position,
	board_size,
	image_shows_preview,
	is_audio_widget,
	is_folder_preview_widget,
	is_image_widget,
	is_model_widget,
	is_note_widget,
	is_shape_widget,
	is_fixed_width_text,
	is_text_widget,
	is_video_widget,
	text_box_css,
	NOTE_DEFAULT_SIZE,
	TEXT_DEFAULT_SIZE,
	IMAGE_DEFAULT_SIZE,
	MODEL_DEFAULT_SIZE,
	SHAPE_SQUARE_DEFAULT_SIZE,
	SHAPE_LINE_DEFAULT_SIZE,
	FOLDER_PREVIEW_DEFAULT_SIZE,
	TILE,
	relative_to_origin,
	shift_into_board_quadrant,
	board_drop_positions,
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

/** The usual helper writes is_preview, so a missing attribute needs its own object. */
function bare(name: string): FolderContainerWidgetChild {
	return { id: `/ws/${name}`, name, type: 'file' }
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
		expect(get_preview_toggle_label('a.md', true, true)).toBe('Show as file')
		expect(get_preview_toggle_label('a.md', false, true)).toBe('Show as text')
		expect(get_preview_toggle_label('a.md', false, false)).toBe('Preview')
		// is_text means nothing outside .md / .txt
		expect(get_preview_toggle_label('a.svg', true, true)).toBe('Show as file')
		expect(get_preview_toggle_label('a.png', false, true)).toBe('Preview')
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
		expect(is_image_widget(bare('a.png'))).toBe(true)
		expect(is_image_widget(file('a.png', { is_preview: false }))).toBe(false)
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

	test('is_text_widget needs the preview, is_text and a text file name', () => {
		expect(is_text_widget(file('Text 1.md', { is_text: true }))).toBe(true)
		expect(is_text_widget(file('a.txt', { is_text: true }))).toBe(true)
		expect(is_text_widget(file('Note 1.md'))).toBe(false)
		expect(is_text_widget(file('Note 1.md', { is_text: false }))).toBe(false)
		expect(is_text_widget(file('Text 1.md', { is_text: true, is_preview: false }))).toBe(false)
		expect(is_text_widget(file('a.svg', { is_text: true }))).toBe(false)
		// a text block is still a note for the views that do not draw it
		expect(is_note_widget(file('Text 1.md', { is_text: true }))).toBe(true)
	})

	test('a text block grows with its text until the user fixes its width', () => {
		const auto = file('Text 1.md', { is_text: true, size: { width: 300, height: 90 } })
		const fixed = file('Text 1.md', { is_text: true, text_width: 'fixed', size: { width: 300, height: 90 } })
		const marked_auto = file('Text 1.md', { is_text: true, text_width: 'auto', size: { width: 300, height: 90 } })
		const note = file('Note 1.md', { text_width: 'fixed', size: { width: 300, height: 90 } })

		expect(is_fixed_width_text(auto)).toBe(false)
		expect(is_fixed_width_text(marked_auto)).toBe(false)
		expect(is_fixed_width_text(fixed)).toBe(true)
		// a note has no text width
		expect(is_fixed_width_text(note)).toBe(false)

		// the height is never stored: it follows the text
		expect(text_box_css(auto)).toEqual({ width: 'max-content', height: 'auto' })
		expect(text_box_css(marked_auto)).toEqual({ width: 'max-content', height: 'auto' })
		expect(text_box_css(fixed)).toEqual({ width: '300px', height: 'auto' })
		// while a side handle is dragged the live width wins in both modes
		expect(text_box_css(auto, 123)).toEqual({ width: '123px', height: 'auto' })
		expect(text_box_css(fixed, 123)).toEqual({ width: '123px', height: 'auto' })
	})

	test('board_size gives a text block its own default, a stored size wins', () => {
		expect(board_size(file('Text 1.md', { is_text: true }))).toEqual(TEXT_DEFAULT_SIZE)
		expect(board_size(file('Text 1.md', { is_text: true, size: { width: 9, height: 8 } })))
			.toEqual({ width: 9, height: 8 })
	})

	test('board_position and board_size use defaults when unset', () => {
		expect(board_position(file('a.txt'), 0)).toEqual({ x: 20, y: 20 })
		expect(board_position(file('a.txt', { position: { x: 1, y: 2 } }), 0)).toEqual({ x: 1, y: 2 })
		expect(board_size(file('a.txt'))).toEqual(NOTE_DEFAULT_SIZE)
		expect(board_size(file('a.png'))).toEqual(IMAGE_DEFAULT_SIZE)
		expect(board_size(bare('a.png'))).toEqual(IMAGE_DEFAULT_SIZE)
		expect(board_size(file('a.glb'))).toEqual(MODEL_DEFAULT_SIZE)
		expect(board_size(file('a.svg'))).toEqual(SHAPE_SQUARE_DEFAULT_SIZE)
		expect(board_size(file('Shape line.svg'))).toEqual(SHAPE_LINE_DEFAULT_SIZE)
		expect(board_size(file('a.txt', { size: { width: 9, height: 8 } }))).toEqual({
			width: 9,
			height: 8,
		})
	})

	test('an image shows until preview is turned off', () => {
		expect(image_shows_preview(bare('a.png'))).toBe(true)
		expect(image_shows_preview(file('a.png', { is_preview: false }))).toBe(false)
		expect(image_shows_preview(bare('a.jpg'))).toBe(true)
		expect(image_shows_preview(bare('a.svg'))).toBe(false)
		expect(is_shape_widget(bare('a.svg'))).toBe(false)
		expect(image_shows_preview(bare('a.txt'))).toBe(false)
		expect(is_note_widget(bare('a.txt'))).toBe(false)
		expect(is_note_widget(bare('a.md'))).toBe(false)
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

describe('shift_into_board_quadrant', () => {
	test('shifts a group that sits entirely in the negative quadrant', () => {
		expect(shift_into_board_quadrant([
			{ x: -100, y: -50 },
			{ x: -80, y: -40 },
		])).toEqual([
			{ x: TILE.pad, y: TILE.pad },
			{ x: TILE.pad + 20, y: TILE.pad + 10 },
		])
	})

	test('shifts only the axis that is negative', () => {
		expect(shift_into_board_quadrant([
			{ x: -10, y: 40 },
			{ x: 50, y: 80 },
		])).toEqual([
			{ x: TILE.pad, y: 40 },
			{ x: 80, y: 80 },
		])
	})

	test('keeps spacing when each widget is negative on a different axis', () => {
		expect(shift_into_board_quadrant([
			{ x: -100, y: 40 },
			{ x: 30, y: -10 },
		])).toEqual([
			{ x: 20, y: 70 },
			{ x: 150, y: 20 },
		])
	})

	test('leaves a non-negative group unchanged', () => {
		const positions = [{ x: 0, y: 0 }, { x: 40, y: 15 }]
		expect(shift_into_board_quadrant(positions)).toBe(positions)
	})

	test('returns an empty list unchanged', () => {
		const positions: { x: number; y: number }[] = []
		expect(shift_into_board_quadrant(positions)).toBe(positions)
	})
})

describe('board_drop_positions', () => {
	test('shifts a canvas drop onto a board and keeps missing positions', () => {
		expect(board_drop_positions('canvas', 'board', [
			{ x: -100, y: 40 },
			null,
			{ x: 30, y: -10 },
		])).toEqual([
			{ x: 20, y: 70 },
			null,
			{ x: 150, y: 20 },
		])
	})

	test('leaves other view pairs unchanged', () => {
		const positions = [{ x: -10, y: -20 }, null]
		expect(board_drop_positions('board', 'board', positions)).toBe(positions)
		expect(board_drop_positions('canvas', 'canvas', positions)).toBe(positions)
		expect(board_drop_positions('canvas', 'list', positions)).toBe(positions)
		expect(board_drop_positions(undefined, 'board', positions)).toBe(positions)
	})

	test('leaves a non-negative canvas drop unchanged', () => {
		const positions = [{ x: 10, y: 20 }, null]
		expect(board_drop_positions('canvas', 'board', positions)).toBe(positions)
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

describe('off the board', () => {
	test('board_quadrant_shift moves only the axis that is negative', () => {
		expect(board_quadrant_shift([{ x: -100, y: 30 }, { x: 50, y: 60 }])).toEqual({ x: 120, y: 0 })
		expect(board_quadrant_shift([{ x: 0, y: 0 }])).toEqual({ x: 0, y: 0 })
	})

	test('off_board_children are those left of or above the board', () => {
		const child = (id: string, position?: { x: number; y: number }) =>
			({ id, name: id, type: 'file', position }) as FolderContainerWidgetChild
		const hidden = off_board_children([
			child('a', { x: -1, y: 10 }),
			child('b', { x: 10, y: -5 }),
			child('c', { x: 0, y: 0 }),
			child('d'),
		])
		expect(hidden.map(c => c.id)).toEqual(['a', 'b'])
	})
})

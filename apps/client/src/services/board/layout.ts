import type { FolderContainerWidget, FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import { get_media_kind } from './media'

export const DEFAULT_GRID_SIZE = 20
export const TILE = { width: 100, height: 100, gap: 10, pad: 20 }
export const COLS = 4
export const DEFAULT_SIZE: Size = { width: TILE.width, height: TILE.height }
export const NOTE_DEFAULT_SIZE: Size = { width: 220, height: 80 }
export const SHAPE_SQUARE_DEFAULT_SIZE: Size = { width: 100, height: 100 }
export const SHAPE_DEFAULT_SIZE: Size = SHAPE_SQUARE_DEFAULT_SIZE
export const SHAPE_LINE_DEFAULT_SIZE: Size = { width: 120, height: 24 }
export const FOLDER_PREVIEW_DEFAULT_SIZE: Size = { width: 240, height: 160 }
export const IMAGE_DEFAULT_SIZE: Size = { width: 200, height: 200 }
export const VIDEO_DEFAULT_SIZE: Size = { width: 320, height: 240 }
export const AUDIO_DEFAULT_SIZE: Size = { width: 280, height: 100 }
export const MODEL_DEFAULT_SIZE: Size = { width: 320, height: 280 }

export type BoardSnapSettings = {
	snap_to_grid: boolean
	grid_size: number
}

/** Runtime snap config passed into drag / endpoint handlers. */
export type BoardSnap = {
	enabled: boolean
	size: number
}

/** Round a position to the grid. Apply to accumulated raw coords, not per-move deltas. */
export function snap_position(position: Position, snap: BoardSnap): Position {
	if (!snap.enabled || snap.size <= 0) return position
	const size = snap.size
	return {
		x: Math.round(position.x / size) * size,
		y: Math.round(position.y / size) * size,
	}
}

export function is_note_widget(widget: FolderContainerWidgetChild): boolean {
	return widget.type === 'file'
		&& widget.is_preview === true
		&& (widget.name.endsWith('.txt') || widget.name.endsWith('.md'))
}

export function is_shape_widget(widget: FolderContainerWidgetChild): boolean {
	return widget.type === 'file'
		&& widget.is_preview === true
		&& widget.name.endsWith('.svg')
}

function is_media_preview_widget(
	widget: FolderContainerWidgetChild,
	kind: 'image' | 'video' | 'audio' | 'model',
): boolean {
	return widget.type === 'file'
		&& widget.is_preview === true
		&& get_media_kind(widget.name) === kind
}

export function is_image_widget(widget: FolderContainerWidgetChild): boolean {
	return is_media_preview_widget(widget, 'image')
}

export function is_video_widget(widget: FolderContainerWidgetChild): boolean {
	return is_media_preview_widget(widget, 'video')
}

export function is_audio_widget(widget: FolderContainerWidgetChild): boolean {
	return is_media_preview_widget(widget, 'audio')
}

export function is_model_widget(widget: FolderContainerWidgetChild): boolean {
	return is_media_preview_widget(widget, 'model')
}

export function is_folder_preview_widget(
	widget: FolderContainerWidgetChild,
): widget is FolderContainerWidget {
	return widget.type === 'folder_container'
}

export function board_position(widget: FolderContainerWidgetChild, index: number): Position {
	if (widget.position) return widget.position

	const col = index % COLS
	const row = Math.floor(index / COLS)
	return {
		x: TILE.pad + col * (TILE.width + TILE.gap),
		y: TILE.pad + row * (TILE.height + TILE.gap),
	}
}

/** Topmost, then leftmost position in a set. */
export function top_left_position(positions: Position[]): Position | undefined {
	let best: Position | undefined
	for (const position of positions) {
		if (
			!best
			|| position.y < best.y
			|| (position.y === best.y && position.x < best.x)
		) {
			// Copy — callers often persist this as a folder origin; sharing the
			// child widget's object would alias mutations across entities.
			best = { x: position.x, y: position.y }
		}
	}
	return best
}

/** Parse a `position` xattr value into `{ x, y }`, or undefined when missing/invalid. */
export function read_position_attr(value: unknown): Position | undefined {
	if (
		value
		&& typeof value === 'object'
		&& typeof (value as Position).x === 'number'
		&& typeof (value as Position).y === 'number'
		&& Number.isFinite((value as Position).x)
		&& Number.isFinite((value as Position).y)
	) {
		return { x: (value as Position).x, y: (value as Position).y }
	}
	return undefined
}

/** Convert parent-space coords to child-space relative to `origin`, optionally padded. */
export function relative_to_origin(
	position: Position,
	origin: Position,
	inset: Position = { x: 0, y: 0 },
): Position {
	return {
		x: position.x - origin.x + inset.x,
		y: position.y - origin.y + inset.y,
	}
}

/** Inverse of `relative_to_origin` — restore parent-space coords. */
export function absolute_from_origin(
	relative: Position,
	origin: Position,
	inset: Position = { x: 0, y: 0 },
): Position {
	return {
		x: relative.x - inset.x + origin.x,
		y: relative.y - inset.y + origin.y,
	}
}

export function board_size(widget: FolderContainerWidgetChild): Size {
	if (widget.size) return widget.size
	if (is_folder_preview_widget(widget)) return FOLDER_PREVIEW_DEFAULT_SIZE
	if (is_note_widget(widget)) return NOTE_DEFAULT_SIZE
	if (is_shape_widget(widget)) {
		return widget.name.toLowerCase().includes('line')
			? SHAPE_LINE_DEFAULT_SIZE
			: SHAPE_DEFAULT_SIZE
	}
	if (is_image_widget(widget)) return IMAGE_DEFAULT_SIZE
	if (is_video_widget(widget)) return VIDEO_DEFAULT_SIZE
	if (is_audio_widget(widget)) return AUDIO_DEFAULT_SIZE
	if (is_model_widget(widget)) return MODEL_DEFAULT_SIZE
	return DEFAULT_SIZE
}

export type BoardContentExtent = {
	minWidth: number
	minHeight: number
}

export function board_content_extent(
	children: FolderContainerWidgetChild[],
	dragPositions: Record<string, Position> = {},
	dragSizes: Record<string, Size> = {},
): BoardContentExtent {
	let maxRight = 0
	let maxBottom = 0

	for (let index = 0; index < children.length; index++) {
		const widget = children[index]
		const { x, y } = dragPositions[widget.id] ?? board_position(widget, index)
		const { width, height } = dragSizes[widget.id] ?? board_size(widget)
		maxRight = Math.max(maxRight, x + width)
		maxBottom = Math.max(maxBottom, y + height)
	}

	if (children.length === 0) {
		return { minWidth: 0, minHeight: 0 }
	}

	return {
		minWidth: maxRight + TILE.pad,
		minHeight: maxBottom + TILE.pad,
	}
}

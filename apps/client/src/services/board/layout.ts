import type { FolderContainerWidget, FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import { get_media_kind } from './media'

export const DEFAULT_GRID_SIZE = 20
export const TILE = { width: 100, height: 100, gap: 10, pad: 20 }
export const COLS = 4
export const DEFAULT_SIZE: Size = { width: TILE.width, height: TILE.height }
export const NOTE_DEFAULT_SIZE: Size = { width: 220, height: 80 }
/** Height stays at the canvas resize minimum (100x50) so a text block can be resized from its default. */
export const TEXT_DEFAULT_SIZE: Size = { width: 200, height: 50 }
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

/** A note file drawn as a bare text block on the board and canvas. Other views still show it as a note. */
export function is_text_widget(widget: FolderContainerWidgetChild): boolean {
	return is_note_widget(widget)
		&& widget.type === 'file'
		&& widget.is_text === true
}

/** A text block whose width the user fixed with a side handle; any other text block grows with its text. */
export function is_fixed_width_text(widget: FolderContainerWidgetChild): boolean {
	return is_text_widget(widget)
		&& widget.type === 'file'
		&& widget.text_width === 'fixed'
}

/**
 * CSS size of a text block's box. The height always follows the text. The
 * width follows it too (`max-content`) until the user fixes it; then it is the
 * stored width, or `width` while a side handle is being dragged.
 */
export function text_box_css(
	widget: FolderContainerWidgetChild,
	width?: number,
): { width: string; height: string } {
	if (width !== undefined) return { width: `${width}px`, height: 'auto' }
	if (is_fixed_width_text(widget)) return { width: `${board_size(widget).width}px`, height: 'auto' }
	return { width: 'max-content', height: 'auto' }
}

export function is_shape_widget(widget: FolderContainerWidgetChild): boolean {
	return widget.type === 'file'
		&& widget.is_preview === true
		&& widget.name.endsWith('.svg')
}

/** A picture is on screen until the file explicitly opts out. Nothing is written for the absence. */
export function image_shows_preview(widget: FolderContainerWidgetChild): boolean {
	return widget.type === 'file'
		&& get_media_kind(widget.name) === 'image'
		&& widget.is_preview !== false
}

function is_media_preview_widget(
	widget: FolderContainerWidgetChild,
	kind: 'video' | 'audio' | 'model',
): boolean {
	return widget.type === 'file'
		&& widget.is_preview === true
		&& get_media_kind(widget.name) === kind
}

export function is_image_widget(widget: FolderContainerWidgetChild): boolean {
	return image_shows_preview(widget)
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

/**
 * How far a group must move to sit in the board's visible quadrant. An axis
 * whose minimum is already >= 0 does not move, so a group that only hangs off
 * the left keeps its vertical arrangement.
 */
export function board_quadrant_shift(positions: Position[]): Position {
	let min_x = Infinity
	let min_y = Infinity
	for (const position of positions) {
		if (position.x < min_x) min_x = position.x
		if (position.y < min_y) min_y = position.y
	}
	return {
		x: min_x < 0 ? TILE.pad - min_x : 0,
		y: min_y < 0 ? TILE.pad - min_y : 0,
	}
}

/**
 * Translate a dropped group so it sits in the board's visible quadrant.
 * Returns the same array when nothing is negative.
 */
export function shift_into_board_quadrant(positions: Position[]): Position[] {
	if (positions.length === 0) return positions

	const { x: dx, y: dy } = board_quadrant_shift(positions)
	if (dx === 0 && dy === 0) return positions

	return positions.map(position => ({
		x: position.x + dx,
		y: position.y + dy,
	}))
}

/**
 * Children the board cannot show: a board starts at 0,0 and does not scroll
 * up or left, so a canvas position left of or above it is out of reach.
 */
export function off_board_children(children: FolderContainerWidgetChild[]): FolderContainerWidgetChild[] {
	return children.filter(child => !!child.position && (child.position.x < 0 || child.position.y < 0))
}

/**
 * Positions a folder drop should store. A canvas → board drop shifts the
 * group into the visible quadrant when any coordinate is negative. Other
 * view pairs are returned unchanged. Missing positions stay null so the
 * board grid fallback can place those widgets.
 */
export function board_drop_positions(
	source_view: string | undefined,
	target_view: string | undefined,
	positions: Array<Position | null>,
): Array<Position | null> {
	if (source_view !== 'canvas' || target_view !== 'board') return positions

	const indexed: Array<{ index: number; position: Position }> = []
	for (let index = 0; index < positions.length; index++) {
		const position = positions[index]
		if (position) indexed.push({ index, position })
	}
	if (indexed.length === 0) return positions

	const defined = indexed.map(entry => entry.position)
	const shifted = shift_into_board_quadrant(defined)
	if (shifted === defined) return positions

	const next = positions.slice()
	for (let index = 0; index < indexed.length; index++) {
		next[indexed[index]!.index] = shifted[index]!
	}
	return next
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
	if (is_text_widget(widget)) return TEXT_DEFAULT_SIZE
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

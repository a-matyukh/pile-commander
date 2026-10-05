import type { FolderContainerWidgetChild, Position, Size } from '@/domain/Widget'
import {
	AUDIO_DEFAULT_SIZE,
	FOLDER_PREVIEW_DEFAULT_SIZE,
	IMAGE_DEFAULT_SIZE,
	is_audio_widget,
	is_folder_preview_widget,
	is_image_widget,
	is_model_widget,
	is_note_widget,
	is_shape_widget,
	is_video_widget,
	MODEL_DEFAULT_SIZE,
	NOTE_DEFAULT_SIZE,
	SHAPE_DEFAULT_SIZE,
	VIDEO_DEFAULT_SIZE,
} from '@/services/board/layout'

export const MASONRY_UNIT = 80
export const MASONRY_GAP = 12
export const MASONRY_DEFAULT_SIZE: Size = { width: 240, height: 240 }

export type MasonryLayoutItem = {
	i: string
	x: number
	y: number
	w: number
	h: number
}

export function masonrySize(widget: FolderContainerWidgetChild): Size {
	if (widget.size) return widget.size
	if (is_folder_preview_widget(widget)) return FOLDER_PREVIEW_DEFAULT_SIZE
	if (is_note_widget(widget)) return NOTE_DEFAULT_SIZE
	if (is_shape_widget(widget)) return SHAPE_DEFAULT_SIZE
	if (is_image_widget(widget)) return IMAGE_DEFAULT_SIZE
	if (is_video_widget(widget)) return VIDEO_DEFAULT_SIZE
	if (is_audio_widget(widget)) return AUDIO_DEFAULT_SIZE
	if (is_model_widget(widget)) return MODEL_DEFAULT_SIZE
	return MASONRY_DEFAULT_SIZE
}

export function masonrySpan(size: Size): { colSpan: number; rowSpan: number } {
	return {
		colSpan: Math.max(1, Math.round(size.width / MASONRY_UNIT)),
		rowSpan: Math.max(1, Math.round(size.height / MASONRY_UNIT)),
	}
}

export function sizeToWH(size: Size): { w: number; h: number } {
	const { colSpan, rowSpan } = masonrySpan(size)
	return { w: colSpan, h: rowSpan }
}

export function whToSize(wh: { w: number; h: number }): Size {
	return {
		width: Math.max(MASONRY_UNIT, wh.w * MASONRY_UNIT),
		height: Math.max(MASONRY_UNIT, wh.h * MASONRY_UNIT),
	}
}

/** Grid-cell coords (not board pixels). Board pixel x is usually >= colNum. */
export function isGridPosition(
	pos: Position | undefined,
	colNum: number,
): pos is Position {
	if (!pos) return false
	const { x, y } = pos
	if (!Number.isFinite(x) || !Number.isFinite(y)) return false
	if (!Number.isInteger(x) || !Number.isInteger(y)) return false
	if (x < 0 || y < 0) return false
	if (x >= colNum) return false
	return true
}

export function colNumFromWidth(width: number, padding = 16): number {
	const available = Math.max(0, width - padding * 2)
	return Math.max(1, Math.floor((available + MASONRY_GAP) / (MASONRY_UNIT + MASONRY_GAP)))
}

function collides(
	a: Pick<MasonryLayoutItem, 'x' | 'y' | 'w' | 'h'>,
	b: Pick<MasonryLayoutItem, 'x' | 'y' | 'w' | 'h'>,
): boolean {
	if (a.x + a.w <= b.x) return false
	if (a.x >= b.x + b.w) return false
	if (a.y + a.h <= b.y) return false
	if (a.y >= b.y + b.h) return false
	return true
}

function findSlot(
	placed: MasonryLayoutItem[],
	w: number,
	h: number,
	colNum: number,
): { x: number; y: number } {
	const maxY = placed.reduce((max, item) => Math.max(max, item.y + item.h), 0) + 1
	for (let y = 0; y <= maxY; y++) {
		for (let x = 0; x <= colNum - w; x++) {
			const candidate = { x, y, w, h }
			if (!placed.some(item => collides(item, candidate))) {
				return { x, y }
			}
		}
	}
	return { x: 0, y: maxY }
}

function clampWH(
	widget: FolderContainerWidgetChild,
	colNum: number,
): { w: number; h: number } {
	const { w, h } = sizeToWH(masonrySize(widget))
	return {
		w: Math.min(Math.max(1, w), colNum),
		h: Math.max(1, h),
	}
}

export function packMasonryLayout(
	widgets: FolderContainerWidgetChild[],
	colNum: number,
): MasonryLayoutItem[] {
	const placed: MasonryLayoutItem[] = []
	for (const widget of widgets) {
		const { w, h } = clampWH(widget, colNum)
		const { x, y } = findSlot(placed, w, h, colNum)
		placed.push({ i: widget.id, x, y, w, h })
	}
	return placed
}

export function widgetsToLayout(
	widgets: FolderContainerWidgetChild[],
	colNum: number,
): MasonryLayoutItem[] {
	const placed: MasonryLayoutItem[] = []
	const needsPack: FolderContainerWidgetChild[] = []

	for (const widget of widgets) {
		const { w, h } = clampWH(widget, colNum)
		if (!isGridPosition(widget.position, colNum)) {
			needsPack.push(widget)
			continue
		}
		const x = Math.min(widget.position.x, colNum - w)
		placed.push({ i: widget.id, x, y: widget.position.y, w, h })
	}

	for (let i = 0; i < placed.length; i++) {
		for (let j = i + 1; j < placed.length; j++) {
			const a = placed[i]
			const b = placed[j]
			if (a && b && collides(a, b)) {
				return packMasonryLayout(widgets, colNum)
			}
		}
	}

	for (const widget of needsPack) {
		const { w, h } = clampWH(widget, colNum)
		const { x, y } = findSlot(placed, w, h, colNum)
		placed.push({ i: widget.id, x, y, w, h })
	}

	return placed
}

export function layoutReadingOrder(layout: MasonryLayoutItem[]): string[] {
	return [...layout]
		.sort((a, b) => a.y - b.y || a.x - b.x)
		.map(item => item.i)
}

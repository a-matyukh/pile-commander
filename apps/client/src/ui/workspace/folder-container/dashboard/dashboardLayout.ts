import type { DashboardCell, FolderContainerWidgetChild, Size } from '@/domain/Widget'
import { dashboard_cell_from_stored } from '@/domain/Widget'
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

/** Fixed column count. Cell width follows the pane; x/y/w/h do not. */
export const DASHBOARD_COLS = 12
export const DASHBOARD_GAP = 12
export const DASHBOARD_ROW_HEIGHT = 80

export type DashboardLayoutItem = {
	i: string
	x: number
	y: number
	w: number
	h: number
}

function defaultSize(widget: FolderContainerWidgetChild): Size {
	if (widget.size) return widget.size
	if (is_folder_preview_widget(widget)) return FOLDER_PREVIEW_DEFAULT_SIZE
	if (is_note_widget(widget)) return NOTE_DEFAULT_SIZE
	if (is_shape_widget(widget)) return SHAPE_DEFAULT_SIZE
	if (is_image_widget(widget)) return IMAGE_DEFAULT_SIZE
	if (is_video_widget(widget)) return VIDEO_DEFAULT_SIZE
	if (is_audio_widget(widget)) return AUDIO_DEFAULT_SIZE
	if (is_model_widget(widget)) return MODEL_DEFAULT_SIZE
	return { width: DASHBOARD_ROW_HEIGHT * 3, height: DASHBOARD_ROW_HEIGHT * 3 }
}

function spanFromSize(size: Size): { w: number; h: number } {
	return {
		w: Math.min(DASHBOARD_COLS, Math.max(1, Math.round(size.width / DASHBOARD_ROW_HEIGHT))),
		h: Math.max(1, Math.round(size.height / DASHBOARD_ROW_HEIGHT)),
	}
}

function collides(
	a: Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'>,
	b: Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'>,
): boolean {
	if (a.x + a.w <= b.x) return false
	if (a.x >= b.x + b.w) return false
	if (a.y + a.h <= b.y) return false
	if (a.y >= b.y + b.h) return false
	return true
}

function findSlot(
	placed: DashboardLayoutItem[],
	w: number,
	h: number,
): { x: number; y: number } {
	const maxY = placed.reduce((max, item) => Math.max(max, item.y + item.h), 0) + 1
	for (let y = 0; y <= maxY; y++) {
		for (let x = 0; x <= DASHBOARD_COLS - w; x++) {
			const candidate = { x, y, w, h }
			if (!placed.some(item => collides(item, candidate))) return { x, y }
		}
	}
	return { x: 0, y: maxY }
}

function clampCell(cell: DashboardCell): Pick<DashboardLayoutItem, 'x' | 'y' | 'w' | 'h'> {
	const w = Math.min(DASHBOARD_COLS, Math.max(1, Math.round(cell.w)))
	const h = Math.max(1, Math.round(cell.h))
	const x = Math.min(Math.max(0, Math.round(cell.x)), DASHBOARD_COLS - w)
	const y = Math.max(0, Math.round(cell.y))
	return { x, y, w, h }
}

/**
 * Places widgets on the 12-column dashboard. A saved `dashboard` cell is kept
 * as-is (clamped into the grid). Pixel `position` is ignored, and the pane
 * width is not an input, so a narrow window cannot repack a wide layout.
 * Widgets without a cell are packed into the first free slot and are not written
 * until the user moves them.
 */
export function widgetsToDashboardLayout(
	widgets: FolderContainerWidgetChild[],
): DashboardLayoutItem[] {
	const placed: DashboardLayoutItem[] = []
	const needsPack: FolderContainerWidgetChild[] = []

	for (const widget of widgets) {
		const cell = dashboard_cell_from_stored(widget.dashboard)
		if (!cell) {
			needsPack.push(widget)
			continue
		}
		placed.push({ i: widget.id, ...clampCell(cell) })
	}

	for (const widget of needsPack) {
		const { w, h } = spanFromSize(defaultSize(widget))
		const { x, y } = findSlot(placed, w, h)
		placed.push({ i: widget.id, x, y, w, h })
	}

	return placed
}

/**
 * Pull every card up to the first free row, keeping x/w/h.
 * vue-grid only compacts while dragging, so a toggle has to do this itself.
 * The result is what is drawn; saved cells stay until a card is moved.
 */
export function compactDashboardLayout(layout: DashboardLayoutItem[]): DashboardLayoutItem[] {
	const sorted = [...layout].sort((a, b) => a.y - b.y || a.x - b.x)
	const placed: DashboardLayoutItem[] = []
	const byId = new Map<string, DashboardLayoutItem>()
	for (const item of sorted) {
		const next = { ...item }
		while (next.y > 0 && !placed.some(other => collides(next, other))) next.y -= 1
		let hit = placed.find(other => collides(next, other))
		while (hit) {
			next.y = hit.y + hit.h
			hit = placed.find(other => collides(next, other))
		}
		placed.push(next)
		byId.set(next.i, next)
	}
	return layout.map(item => byId.get(item.i) ?? item)
}

/** Cards whose cell changed, or that have never been saved. */
export function dashboardCellsToWrite(
	layout: DashboardLayoutItem[],
	current: ReadonlyMap<string, DashboardCell | undefined>,
): DashboardLayoutItem[] {
	return layout.filter(item => {
		const prev = current.get(item.i)
		if (!prev) return true
		const next = clampCell(item)
		return prev.x !== next.x || prev.y !== next.y || prev.w !== next.w || prev.h !== next.h
	})
}

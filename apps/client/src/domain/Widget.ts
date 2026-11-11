//////////////////// primitives /////////////////////////

export type ImageBase64 = string
export type Color = string
export type Position = {
	x: number
	y: number
};
export type Size = {
	width: number
	height: number
}

/** Dashboard grid cell. Column count is fixed, so these survive a pane resize. */
export type DashboardCell = {
	x: number
	y: number
	w: number
	h: number
}

export function dashboard_cell_from_stored(value: unknown): DashboardCell | undefined {
	if (!value || typeof value !== 'object') return undefined
	const cell = value as Record<string, unknown>
	const { x, y, w, h } = cell
	if (
		typeof x !== 'number' || typeof y !== 'number'
		|| typeof w !== 'number' || typeof h !== 'number'
	) return undefined
	if (![x, y, w, h].every(Number.isFinite)) return undefined
	if (x < 0 || y < 0 || w < 1 || h < 1) return undefined
	return { x, y, w, h }
}
// export type ISODate = string
// export type Path = string


///////////////////////// Xattrs

type CommonXattrs = Partial<{
	position: Position
	size: Size
	/**
	 * Height of the item's bottom above the floor in the 3D view, board px.
	 * Its own attribute, not part of `position`: the board, the canvas and
	 * older versions write `position` whole and would drop it
	 */
	z: number
	/** Grid cell for the dashboard view. Board and canvas keep using position and size. */
	dashboard: DashboardCell
	background: ImageBase64 | Color
	is_preview: boolean // is_preview, is opened, is expanded
	order: number
}>

export type ModelCameraState = {
	orbit: string
	target: string
	fieldOfView: string
}

type FileXattrs = CommonXattrs & Partial<{
	/** A `.md` / `.txt` preview drawn as a text block (no card) instead of a note. Kept while the preview is off. */
	is_text: boolean
	/**
	 * A text block's width. Absent or "auto": the box grows to the right with the
	 * text and breaks lines only at Enter. "fixed": the user dragged a side
	 * handle, `size.width` is the width and the text wraps inside it.
	 */
	text_width: 'auto' | 'fixed'
	padding: number
	cover: ImageBase64 | Color
	model_camera: ModelCameraState
	/** Heading drawn above an image preview. */
	title: string
	/** Caption drawn below an image preview. */
	description: string
	/** A shape's text, as markdown (stage 4 of the text plan in pile-commander-product). Absent: no text. */
	text: string
	/** Where a shape's text sits: absent, inside the shape; "frame", the whole frame. */
	text_area: 'frame'
}>

type FolderCoverXattrs = CommonXattrs & Partial<{
	cover: ImageBase64 | Color
}>

export const FOLDER_VIEWS = [
	"list",  // стандартный вид списком как в проводнике
	"grid",  // стандартный вид сеткой как в проводнике
	"board",
	"canvas",
	"3d",  // the board in space: the board's and canvas's places, plus height
	"stack",  // sortable
	"masonry",
	"dashboard",
	"slides",
  ] as const

export type FolderView = (typeof FOLDER_VIEWS)[number]

/**
 * A folder's `view` attribute as stored. Gallery is `grid` in the code and is
 * stored as "gallery" since 2.3; "grid", which earlier versions wrote, still
 * reads as Gallery. Anything unknown, or none, is a list
 */
export function folder_view_from_stored(raw: unknown): FolderView {
	const view = raw === 'gallery' ? 'grid' : raw
	return (FOLDER_VIEWS as readonly unknown[]).includes(view) ? view as FolderView : 'list'
}

/**
 * The floor of the 3D view, per folder: a table the size of the layout, or
 * an endless floor that fades at the horizon. Items move anywhere on both
 */
export type Floor3D = 'table' | 'infinite'

/** Anything but "infinite", or none, is the table */
/** A folder's on/off choices of the 3D view, kept in its attributes; absent is off */
export type Option3D = 'names_3d'

export function floor_3d_from_stored(raw: unknown): Floor3D {
	return raw === 'infinite' ? 'infinite' : 'table'
}

export function stored_folder_view(view: FolderView): string {
	return view === 'grid' ? 'gallery' : view
}

export type HandlePosition = 'top' | 'right' | 'bottom' | 'left'

/** Vue Flow MarkerType values; undefined = no marker. */
export type ConnectionMarker = 'arrow' | 'arrowclosed'

export type Connection = {
	id: string
	from: string
	to: string
	from_handle?: HandlePosition
	to_handle?: HandlePosition
	marker_start?: ConnectionMarker
	marker_end?: ConnectionMarker
	is_animated: boolean
	/** Mid-edge caption; omitted or empty means no visible label. */
	label?: string
}

export type StrokeNode = {
	id: string
	type: 'stroke'
	/** Render/persist order — replaces the former array index. */
	z: number
	position: Position
	points: Position[]
	color: string
	stroke_width: number
	width: number
	height: number
}

type FolderContainerXattrs = CommonXattrs & {
	view: FolderView
} & Partial<{
	snap_to_grid: boolean
	grid_size: number
	show_grid_dots: boolean
	show_axes: boolean
	selected_slide_index: number
	/** When true, the dashboard pulls cards up. Absent is off, and toggling it does not rewrite cells. */
	dashboard_compact: boolean
	/** Masonry column width in pixels. Absent is the M preset (240). */
	masonry_column_width: number
	/** Masonry column cap. Absent or 0 means as many as fit. */
	masonry_columns: number
	/** The 3D view's floor. Absent is the table */
	floor_3d: Floor3D
	/** 3D: names under pictures and models. Absent is off */
	names_3d: boolean
}>

///////////////////////// Widgets

type BaseWidget = {
	id: string
	name: string
}
type FileWidget = BaseWidget & { type: "file" } & FileXattrs

type FolderCoverWidget = BaseWidget & { type: "folder_cover" } & FolderCoverXattrs

export
type FolderContainerWidget = BaseWidget & { type: "folder_container" } & FolderContainerXattrs & {
	children: FolderContainerWidgetChild[]
}
export
type FolderContainerWidgetChild = FileWidget | FolderCoverWidget | FolderContainerWidget

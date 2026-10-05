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
// export type ISODate = string
// export type Path = string


///////////////////////// Xattrs

type CommonXattrs = Partial<{
	position: Position
	size: Size
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
	padding: number
	cover: ImageBase64 | Color
	model_camera: ModelCameraState
}>

type FolderCoverXattrs = CommonXattrs & Partial<{
	cover: ImageBase64 | Color
}>

export const FOLDER_VIEWS = [
	"list",  // стандартный вид списком как в проводнике
	"grid",  // стандартный вид сеткой как в проводнике
	"board",
	"canvas",
	"stack",  // sortable
	"masonry",  // also sortable
	"slides",
  ] as const

export type FolderView = (typeof FOLDER_VIEWS)[number]

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

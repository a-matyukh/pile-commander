interface Position {
	x: number
	y: number
}
interface Size {
    width: number
    height: number
}

//////////////////////////////////////////

interface FolderConfig {
	view: ViewType
	widgets: Widget[]
}
type ViewType = "stack" | "board" | "masonry"


// Всё есть Widget. Папка, файл и заметка являются Виджетами 
type WidgetType = "folder" | "group" | "file" | "note" | "audio" | "video" | "image" | "sketch"
type WidgetPath = string // путь файла + идентификатор
type WidgetName = string // имя файла + идентификатор
type Widget = {
	type: WidgetType
	name: WidgetName
	position: Position
	size: Size
    bg_color?: string
}

type Buffer = {
	from_folder_path: string,
	widget_name: string,
	to_folder_path: string,
}
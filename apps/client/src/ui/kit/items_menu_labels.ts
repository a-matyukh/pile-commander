import type { FolderView } from '@/domain/Widget'
import { t } from '@/i18n'
import { FOLDER_VIEW_META } from '@/store/explorer/folder_header'

/**
 * The current app's menu items are English and iconless; in the Explorer
 * they speak its language and carry icons as its own menus do. Keyed by the
 * old label, so the old interface stays as it is. A label not listed shows
 * as it is
 */
const ITEMS: Record<string, [key: string, icon: string]> = {
	'View': ['view', 'tabler:layout-dashboard'],
	'New': ['new', 'tabler:plus'],
	'Folder': ['folder', 'tabler:folder-plus'],
	'Text file': ['text_file', 'tabler:file-text'],
	'Markdown file': ['markdown_file', 'tabler:markdown'],
	'Note': ['note', 'tabler:note'],
	'Shape': ['shape', 'tabler:shape'],
	'Rectangle': ['rectangle', 'tabler:square'],
	'Circle': ['circle', 'tabler:circle'],
	'Triangle': ['triangle', 'tabler:triangle'],
	'Diamond': ['diamond', 'tabler:square-rotated'],
	'Line / Arrow': ['line_arrow', 'tabler:line'],
	'Line': ['line', 'tabler:line'],
	'Arrow': ['arrow', 'tabler:arrow-narrow-right'],
	'Import files…': ['import', 'tabler:upload'],
	'Summarize board': ['summarize_board', 'tabler:sparkles'],
	'Summarize': ['summarize', 'tabler:sparkles'],
	'Suggest names': ['suggest_names', 'tabler:wand'],
	'Toolbar': ['toolbar', 'tabler:tools'],
	'Hide': ['hide', 'tabler:eye-off'],
	'Compact view': ['compact', 'tabler:layout-navbar-collapse'],
	'Side': ['side', 'tabler:layout-sidebar'],
	'Top': ['top', 'tabler:arrow-bar-to-up'],
	'Bottom': ['bottom', 'tabler:arrow-bar-to-down'],
	'Grid': ['grid', 'tabler:grid-dots'],
	'Snap to grid': ['snap', 'tabler:layout-align-middle'],
	'Grid size': ['grid_size', 'tabler:dimensions'],
	'Show grid dots': ['dots', 'tabler:grid-4x4'],
	'Show axes': ['axes', 'tabler:axis-x'],
	'Background': ['background', 'tabler:background'],
	'Cover': ['cover', 'tabler:photo'],
	'Fill': ['fill', 'tabler:paint'],
	'Color': ['color', 'tabler:palette'],
	'Open folder': ['open_folder', 'tabler:folder-open'],
	'Open file': ['open_file', 'tabler:eye'],
	'Preview': ['preview', 'tabler:layout-cards'],
	'Hide preview': ['hide_preview', 'tabler:layout-off'],
	'Show as file': ['show_as_file', 'tabler:file'],
	'Show as shape': ['show_as_shape', 'tabler:shape'],
	'Uncombine': ['uncombine', 'tabler:stack-pop'],
	'Start arrow': ['start_arrow', 'tabler:arrow-narrow-left'],
	'End arrow': ['end_arrow', 'tabler:arrow-narrow-right'],
	'Cut': ['cut', 'tabler:cut'],
	'Copy': ['copy', 'tabler:copy'],
	'Duplicate': ['duplicate', 'tabler:copy-plus'],
	'Rename': ['rename', 'tabler:pencil'],
	'Remove': ['remove', 'tabler:trash'],
}

/** The old view switcher's names */
const VIEWS: Record<string, FolderView> = {
	List: 'list',
	Grid: 'grid',
	Board: 'board',
	Canvas: 'canvas',
	Stack: 'stack',
	Masonry: 'masonry',
	Slides: 'slides',
}

export type ItemLook = { label: string; icon?: string; icon_color?: string }

/** An old item's label and icon in the Explorer. `view`: a choice of the view switcher */
export function item_look(label: string, view = false): ItemLook {
	const folder_view = view ? VIEWS[label] : undefined
	if (folder_view) {
		const meta = FOLDER_VIEW_META[folder_view]
		return { label: t(meta.label_key), icon: meta.icon, icon_color: meta.color ?? undefined }
	}
	const known = ITEMS[label]
	return known ? { label: t(`board_menu.${known[0]}`), icon: known[1] } : { label }
}

/** The current view's name beside "View" */
export function view_label(label: string | undefined): string {
	const folder_view = label ? VIEWS[label] : undefined
	return folder_view ? t(FOLDER_VIEW_META[folder_view].label_key) : label ?? ''
}

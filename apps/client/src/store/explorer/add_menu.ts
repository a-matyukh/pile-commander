import type { WorkspaceStore } from '@/domain/Store'
import type { FolderView, Position } from '@/domain/Widget'
import { SHAPE_TEMPLATES, type ShapeTemplate } from '@/domain/shapes'
import { SHAPE_LINE_DEFAULT_SIZE } from '@/services/board/layout'

/** A "Shape ›" item: the shape templates, with the line split into a line and an arrow */
export type AddShape = Exclude<ShapeTemplate, 'line'> | 'line' | 'arrow'

/** In the order of the current pane menu (useFolderContainerMenuItems) */
export const ADD_SHAPES: readonly AddShape[] = SHAPE_TEMPLATES.flatMap((template): AddShape[] =>
	template === 'line' ? ['line', 'arrow'] : [template])

export const ADD_SHAPE_META: Record<AddShape, { icon: string; label_key: string }> = {
	rect: { icon: 'tabler:square', label_key: 'add.shapes.rect' },
	ellipse: { icon: 'tabler:circle', label_key: 'add.shapes.ellipse' },
	triangle: { icon: 'tabler:triangle', label_key: 'add.shapes.triangle' },
	diamond: { icon: 'tabler:diamond', label_key: 'add.shapes.diamond' },
	line: { icon: 'tabler:line', label_key: 'add.shapes.line' },
	arrow: { icon: 'tabler:arrow-narrow-right', label_key: 'add.shapes.arrow' },
}

/** Notes and shapes live on a pane: every view but the list and the gallery */
export function add_menu_has_pane_items(view: FolderView): boolean {
	return view !== 'list' && view !== 'grid'
}

/** Where the current pane menu starts a line when it has no click point */
const LINE_START: Position = { x: 100, y: 100 }

/** The pane menu's "Note": no click point, the store places it */
export function add_note(workspace: WorkspaceStore, folder_id: string): Promise<string> {
	return workspace.create_note(folder_id)
}

/** The pane menu's "Shape ›" items, through the same store calls */
export function add_shape(workspace: WorkspaceStore, folder_id: string, shape: AddShape): Promise<string> {
	if (shape === 'line' || shape === 'arrow') {
		return workspace.create_line(
			folder_id,
			LINE_START,
			{ x: LINE_START.x + SHAPE_LINE_DEFAULT_SIZE.width, y: LINE_START.y },
			shape === 'arrow' ? 'arrow' : 'none',
		)
	}
	return workspace.create_shape(folder_id, shape)
}

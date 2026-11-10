import type { EditorTool } from './drawing/types'

/**
 * The tool a canvas opens with. Select where Space is at hand to move the
 * canvas for a moment. Hand wherever it is not:
 *
 * - a touch screen has no Space, and Select there neither moves nor zooms
 *   the canvas with fingers;
 * - a viewer only looks around;
 * - a hidden toolbar is always Hand;
 * - a folder preview is for looking, and Space does not reach it.
 */
export function default_canvas_tool(options: {
	can_write: boolean
	hidden: boolean
	embedded: boolean
	coarse: boolean
}): EditorTool {
	if (options.hidden || !options.can_write || options.embedded || options.coarse) return 'hand'
	return 'select'
}

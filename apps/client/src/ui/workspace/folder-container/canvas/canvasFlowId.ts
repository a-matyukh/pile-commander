let created = 0

/**
 * The id of one Canvas on screen: its Vue Flow store, and the ids Vue Flow
 * builds from it for the grid's `<pattern>` (`fill="url(#pattern-…)"`) and
 * the arrow markers.
 *
 * A counter, not the folder's path. A path with `(`, `)` or `'` made that
 * `url()` invalid CSS and the pane painted solid black. And an id that names
 * a folder is shared by every canvas of that folder: the pane and a preview
 * of it then show one store's widgets.
 */
export function nextCanvasFlowId(): string {
	created += 1
	return `canvas-${created}`
}

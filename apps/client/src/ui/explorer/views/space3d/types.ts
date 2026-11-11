/**
 * The 3D scene knows nothing of Vue, stores or i18n: the view hands it the
 * folder's items in board pixels and gets back what the person did. It came
 * over from the prototype as it was; only the view around it is the app's.
 */

export type SceneKind = 'note' | 'image' | 'model' | 'folder' | 'file'

/** A table the size of the layout, or a grid with no edge that fades in the distance */
export type SceneFloor = 'table' | 'infinite'

/** A piece of a note's line in one style: as the board draws the note's markdown and its colors */
export type NoteRun = { text: string; bold?: boolean; italic?: boolean; strike?: boolean; code?: boolean; color?: string; mark?: string }

/** A line of a note's card: `level` 1–3 is a heading, 0 plain text; `gap` an empty line between paragraphs; `text` is its runs' text */
export type NoteLine = { text: string; level: number; gap?: boolean; runs?: NoteRun[] }

/** One item of the folder, as the scene draws it */
export type SceneItem = {
	key: string
	kind: SceneKind
	/** Box on the floor in board px: top-left corner and size, as on the board */
	x: number
	y: number
	w: number
	h: number
	/** Height of the item's bottom above the floor, px; null: the default for its kind */
	z: number | null
	/** note: its text line by line, as the board shows it; `paper` is the note's color */
	lines?: NoteLine[]
	paper?: string
	/** folder or file: its color, null for a plain one */
	tint?: string | null
	/** folder: its cover's color, which fills it as on the board */
	fill?: string | null
	/** folder or file: an Iconify icon, e.g. "tabler:folder" */
	icon?: string
	/** folder or file: the name written on its card, as on the board's tiles */
	label?: string
	/** image or model: the file's content; null while it is not known yet */
	url?: string | null
	/** model: its content could not be had (the card says so) */
	failed?: boolean
	/** model: its turn about its own axis, radians, as the board's viewer shows it */
	yaw?: number
	/** image without content: placeholder color */
	tone?: string
	/** image: a GIF, whose first frame is often empty; the card shows its fullest one */
	gif?: boolean
}

/** `covered`: another item stands between the camera and the label's place */
export type LabelSpot = { x: number; y: number; width: number; visible: boolean; covered: boolean }

/** Where the HTML over the scene goes after a frame, in px of the scene's box */
export type SceneFrame = {
	/** A name label's top center, by item key */
	labels: Map<string, LabelSpot>
	/** Top-right corner of the item whose "⋯" shows; null when none is on screen */
	badge: { x: number; y: number } | null
}

export type SceneOptions = {
	/** CSS font family of the app */
	font: string
	motion: boolean
	floor: SceneFloor
	/** Lines on the floor, the table's and the endless one's */
	grid: boolean
	/** Endless floor: the ground as far as the camera sees, so a horizon shows */
	horizon: boolean
	/** Items can be dragged (not in a read-only folder) */
	movable: boolean
	text: { loading: string; failed: string }
	/** A click on an item, or on empty space (null) */
	on_select(key: string | null): void
	/** Double click: a folder opens, a file gets the camera */
	on_open(key: string): void
	/**
	 * An item was dragged: its new top-left corner, board px, and its height
	 * when the drag set one (null: it keeps the default for its kind)
	 */
	on_move(key: string, place: { x: number; y: number; z: number | null }): void
	/** A right click or a long press that did not move: the item's menu; null for empty space */
	on_menu(key: string | null): void
	on_frame(frame: SceneFrame): void
	/** The first drag of an item: tell how to change its height */
	on_hint(): void
	/** A model was turned with its handle: its turn about its own axis, radians */
	on_turn(key: string, yaw: number): void
}

export interface Scene3D {
	set_items(items: SceneItem[]): void
	/** Rings on all of them; the last one gets the "⋯" */
	set_selected(keys: readonly string[]): void
	set_motion(on: boolean): void
	set_movable(on: boolean): void
	set_floor(floor: SceneFloor): void
	set_grid(on: boolean): void
	set_horizon(on: boolean): void
	/** The whole folder from the front; `instant` skips the flight */
	home(instant?: boolean): void
	/** Straight from above: the board as it is */
	top(): void
	/** Closer below 1, farther above 1 */
	zoom(factor: number): void
	/** The camera comes to an item and circles around it */
	focus(key: string): void
	/** The camera dives into a folder; resolves when it is there */
	fly_into(key: string): Promise<void>
	/** False pauses rendering (hidden tab) */
	set_active(active: boolean): void
	/**
	 * A handle by the "⋯", dragged `dx`, `dy` CSS px from where it was pressed:
	 * `height` raises or lowers the item, `turn` turns a model about its axis
	 */
	handle(key: string, kind: 'height' | 'turn', dx: number, dy: number): void
	/** The handle let go: what it changed is kept (`on_move`, `on_turn`), or put back */
	handle_end(key: string, kind: 'height' | 'turn', keep: boolean): void
	/** Draws a frame now, so the HTML over the scene (the "⋯") is in place before a menu opens at it */
	sync(): void
	/** The camera is not where home() puts it */
	readonly away: boolean
	dispose(): void
}

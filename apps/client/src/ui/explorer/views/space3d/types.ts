/**
 * The 3D scene knows nothing of Vue, stores or i18n: the view hands it the
 * folder's items in board pixels and gets back what the person did. It came
 * over from the prototype as it was; only the view around it is the app's.
 */

export type SceneKind = 'note' | 'image' | 'model' | 'folder' | 'file'

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
	/** note: first lines and the file name; `paper` is the note's color */
	title?: string
	text?: string
	footer?: string
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
	/** image without content: placeholder color */
	tone?: string
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
	/** Items can be dragged (not in a read-only folder) */
	movable: boolean
	text: { loading: string; failed: string }
	/** A click on an item, or on empty space (null) */
	on_select(key: string | null): void
	/** Double click: a folder opens, a file gets the camera */
	on_open(key: string): void
	/** An item was dragged: new top-left corner and height, board px */
	on_move(key: string, place: { x: number; y: number; z: number }): void
	/** A right click or a long press that did not move: the item's menu; null for empty space */
	on_menu(key: string | null): void
	on_frame(frame: SceneFrame): void
	/** The first drag of an item: tell how to change its height */
	on_hint(): void
}

export interface Scene3D {
	set_items(items: SceneItem[]): void
	/** Rings on all of them; the last one gets the "⋯" */
	set_selected(keys: readonly string[]): void
	set_motion(on: boolean): void
	set_movable(on: boolean): void
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
	/** Draws a frame now, so the HTML over the scene (the "⋯") is in place before a menu opens at it */
	sync(): void
	/** The camera is not where home() puts it */
	readonly away: boolean
	dispose(): void
}

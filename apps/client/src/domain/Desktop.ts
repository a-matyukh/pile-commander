import type { Color, ImageBase64, Position, Size } from './Widget'
import type { WorkspacesListItem } from './WorkspacesList'

export
type WindowState = 'minimized' | 'floating' | 'fullscreen'

export
type WindowContent =
	// standard WorkspaceWindow as is (sidebar + tabs + FolderContainer)
	| { kind: 'workspace'; item: WorkspacesListItem }
	| { kind: 'empty' }
	| { kind: 'hub' }
	| { kind: 'profile'; username: string }
	| { kind: 'slug'; username: string; slug: string; name?: string }

export
type AppWindow = {
	id: string
	content: WindowContent
	position: Position
	size: Size
	state: WindowState
	/**
	 * Stacking order inside the desktop: larger = closer to the front.
	 * Kept separate from the windows array so that focusing a window does
	 * not reshuffle the taskbar list (the array is the taskbar order).
	 */
	z: number
}

/** Top-most non-minimized window of the desktop (null when none match). */
export
function focused_window(
	desktop: Desktop,
	predicate?: (window: AppWindow) => boolean,
): AppWindow | null {
	let top: AppWindow | null = null
	for (const window of desktop.windows) {
		if (window.state === 'minimized') continue
		if (predicate && !predicate(window)) continue
		if (!top || window.z > top.z) top = window
	}
	return top
}

export
type DesktopBackend = 'local' | 'cloud'

export
type Desktop = {
	id: string
	/**
	* local: lives in localStorage (children — in ~/Pile Commander/desktops
	* or in a custom folder, Tauri);
	* cloud: row in the desktops table, synced after login
	*/
	backend: DesktopBackend
	name: string
	/**
	 * local only: absolute path of the user folder adopted as the desktop
	 * root (picked at creation, human-readable). Absent = the default
	 * ~/Pile Commander/desktops/<id> folder. Never synced: the desktops
	 * table has no path column and CloudDesktopPatch omits it.
	 */
	path?: string
	xattrs: {
		background?: ImageBase64 | Color
		grid?: number
		snap_to_grid?: boolean
	}
	// array order = taskbar order; z-order — in AppWindow.z
	windows: AppWindow[]
}

/** Cloud desktop fields that are linked into a row in the desktops table. */
export
type CloudDesktopPatch = {
	name?: string
	xattrs?: Desktop['xattrs']
	windows?: AppWindow[]
	position?: number
}

export
type DesktopsMode = 'fullscreen' | 'desktops'

export
type DesktopsState = {
	mode: DesktopsMode
	desktops: Desktop[]
	selected_desktop_id: string
}

/** `username/slug` for a public window; null for every other content kind. */
export
function public_window_path(window: AppWindow): string | null {
	const content = window.content
	return content.kind === 'slug' ? `${content.username}/${content.slug}` : null
}

export
function window_title(window: AppWindow, loaded_name?: string | null): string {
	switch (window.content.kind) {
		case 'workspace': return loaded_name || window.content.item.name
		case 'empty': return 'Select workspace'
		case 'hub': return 'Hub'
		case 'profile': return `@${window.content.username}`
		case 'slug': return loaded_name || window.content.name || `${window.content.username}/${window.content.slug}`
	}
}

/** True if this window should keep a store loaded for `item`.
 *  Slug windows hold a public cloud workspace — they have no `item` field. */
export
function window_content_matches_item(
	content: WindowContent,
	item: WorkspacesListItem,
): boolean {
	if (content.kind === 'slug') return item.type === 'cloud'
	return content.kind === 'workspace'
		&& content.item.type === item.type
		&& content.item.id === item.id
}

/**
 * Same view carried into desktops mode: a workspace by type + id, a public
 * slug, a profile, or the hub. Empty windows never match — entering desktops
 * must not reuse a blank window as the current workspace.
 */
export
function same_window_content(a: WindowContent, b: WindowContent): boolean {
	switch (a.kind) {
		case 'workspace':
			return b.kind === 'workspace'
				&& a.item.type === b.item.type
				&& a.item.id === b.item.id
		case 'slug':
			return b.kind === 'slug' && a.username === b.username && a.slug === b.slug
		case 'profile':
			return b.kind === 'profile' && a.username === b.username
		case 'hub':
			return b.kind === 'hub'
		case 'empty':
			return false
	}
}

const WINDOW_STATES = ['minimized', 'floating', 'fullscreen'] as const

/** Tolerant read of window from persistent/sinked payload; null = discard */
export
function normalize_window(raw: Partial<AppWindow> | null, index: number): AppWindow | null {
	if (!raw || typeof raw.id !== 'string' || !raw.content || !raw.position || !raw.size) return null
	return {
		id: raw.id,
		content: raw.content,
		position: raw.position,
		size: raw.size,
		state: (WINDOW_STATES as readonly string[]).includes(raw.state as string)
			? raw.state as WindowState
			: 'floating',
		// persisted before z existed: fall back to the array order
		z: typeof raw.z === 'number' && Number.isFinite(raw.z) ? raw.z : index + 1,
	}
}

/**
 * Desktop read-tolerant (localStorage payload or table row
 * desktops); backend is substituted by source, null = discard
 */
export
function normalize_desktop(raw: unknown, backend: DesktopBackend): Desktop | null {
	if (!raw || typeof raw !== 'object') return null
	const d = raw as Partial<Desktop>
	if (typeof d.id !== 'string' || typeof d.name !== 'string') return null
	return {
		id: d.id,
		backend,
		name: d.name,
		// adopted folders are a local-only concept (see Desktop.path)
		...(backend === 'local' && typeof d.path === 'string' && d.path ? { path: d.path } : {}),
		xattrs: typeof d.xattrs === 'object' && d.xattrs ? d.xattrs : {},
		windows: (Array.isArray(d.windows) ? d.windows : [])
			.map((w, index) => normalize_window(w, index))
			.filter((w): w is AppWindow => w !== null),
	}
}

import type { WorkspacesListItem, WorkspacesList, WorkspaceType } from '@/domain/WorkspacesList'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import type { ShapeTemplate } from '@/domain/shapes'
import type { LinePlug, LineAxis } from '@/services/board/shapes'
import type { EntryContentCaches } from '@/ui/workspace/folder-container/textContentCache'
import type { MediaSrcCache } from '@/ui/workspace/folder-container/media/mediaSrcCache'
import type { AppWindow } from './Desktop'
import { Color, Connection, FolderContainerWidget, FolderContainerWidgetChild, FolderView, ImageBase64, ModelCameraState, Position, Size, StrokeNode } from './Widget'
import { FolderWithChildrenXattrs, MediaSrc, FileManager } from '@pile-commander/file-manager'

export
type LoadWorkspaceOptions = {
	/**
	 * Public URL opened by slug: forces a read-only store. Membership
	 * (owner/editor/viewer) only decides live updates — anon and signed-in
	 * outsiders read the board once, without realtime.
	 */
	public_readonly?: boolean
	/**
	 * Desktops mode: open as a new floating window (Start menu / folder drop).
	 * Default when neither this nor `replace_window_id` is set.
	 */
	as_new_window?: boolean
	/**
	 * Desktops mode: load the workspace into this existing window
	 * (header Workspaces button — replace in place).
	 */
	replace_window_id?: string
}

export
type Store = {
	is_workspace_loading: boolean
	/** Message of the last failed root-level operation (e.g. workspace load). */
	last_error: string | null
	clear_error(): void
	/** Opens a folder picker when `path` is omitted; otherwise opens that folder as a local workspace. */
	open_local_workspace(path?: string, opts?: LoadWorkspaceOptions): Promise<void>
	/** Opens an in-memory demo workspace (works in web without Tauri FS). */
	open_demo_workspace(opts?: LoadWorkspaceOptions): Promise<void>
	/** Exports the open local or cloud workspace to a `.pile` archive. Desktop only. */
	export_current_workspace(): Promise<void>
	/**
	 * Saves a public cloud workspace whose author allows forks and downloads as a
	 * `.pile` on this device: a save dialog in the desktop app, a browser
	 * download on the web. Takes a signed-in visitor: the originals are charged
	 * to them.
	 */
	download_public_workspace(ws: WorkspaceStore): Promise<void>
	/** Imports a `.pile` archive into a chosen folder and opens it. Desktop only.
	 * When `pile_path` is set (Open With / double-click), skips the file picker.
	 */
	import_workspace_pack(pile_path?: string, opts?: LoadWorkspaceOptions): Promise<void>
	load_workspace(ws: WorkspacesListItem, opts?: LoadWorkspaceOptions): Promise<void>
	/** Closes the open workspace (e.g. after its cloud workspace was removed). */
	close_workspace(): void
	/** Unloads the workspace from a desktop window without closing the window. */
	eject_workspace(window_id: string): void
	/**
	 * fullscreen app mode → desktops mode, moving the open view into a window.
	 * Reuses a window that already shows that view. `minimize` puts that
	 * window on the taskbar instead of leaving it floating.
	 * No-op (returns null) while the desktops experiment is off.
	 */
	enter_desktops_mode(opts?: { minimize?: boolean }): AppWindow | null
	/**
	 * desktops mode → fullscreen app mode (the experiment switch turned off):
	 * the focused workspace window's live store becomes the fullscreen
	 * workspace. Desktops and their windows are kept as they are.
	 */
	exit_desktops_mode(): void
	workspace: WorkspaceStore | null

	bookmarks: WorkspacesList
	last_opened: WorkspacesList
	add_to_bookmarks(ws: WorkspacesListItem): void
	remove_from_bookmarks(ws: WorkspacesListItem): void
}

export
type ImportProgress = {
	file_name: string
	/** 1-based index of the file currently uploading. */
	file_index: number
	total_files: number
	loaded_bytes: number
	total_bytes: number
}

export
type WorkspaceTab = {
	/** Stable tab identity (survives folder rename, which changes folder_id). */
	id: string
	folder_id: string
	back_stack: string[]
}

export
type WorkspaceStore = {

	/** Root folder id; equals the workspace path for local/demo, "/" for cloud. */
	id: string
	/** Workspace identity (bookmarks, last-opened, cloud workspace UUID). */
	uid: string
	type: WorkspaceType
	name: string

	/**
	 * The store's file manager. Exposed for cross-store transfers (desktop →
	 * workspace): the counterpart store reads/writes entries through it.
	 */
	file_manager: FileManager

	/**
	 * False for read-only access (cloud viewer role): UI disables mutations
	 * and store methods refuse with a clear error. RLS is the final boundary.
	 */
	can_write: boolean

	/**
	 * False for a public-link visitor without membership: the board was read
	 * once and the store holds no realtime subscription, so it does not change
	 * until a reload.
	 */
	live: boolean

	/** Message of the last failed fs operation; UI may show and reset it. */
	last_error: string | null
	clear_error(): void

	/** Stops the FS watcher. Called when replacing or unloading the workspace. */
	dispose(): void

	/**
	 * Session caches of entry text content (note markdown, shape SVG), owned
	 * by this store. Never module-level: entry ids are paths, which repeat
	 * across workspaces (a fork copies the tree verbatim) and would leak
	 * content between windows.
	 */
	content_caches: EntryContentCaches
	/** Same scoping for media object URLs; revoked in dispose(). */
	media_cache: MediaSrcCache

	// Tree
	tree: WorkspaceTree
	/** Folder ids whose children are projected into the sidebar tree. */
	tree_loaded_folder_ids: Set<string>
	expanded_folder_ids: Set<string>
	is_folder_expanded(folder_id: string): boolean
	toggle_folder_expanded(folder_id: string): void
	/**
	 * Ensures a folder is expanded and has a children array for drag-and-drop,
	 * then loads children if needed.
	 */
	prepare_folder_for_drop(folder_id: string, should_apply?: () => boolean): void
	/** Expands `folder_id` and its ancestors in the sidebar tree, loading children if needed. */
	expand_folder_in_sidebar(folder_id: string, should_apply?: () => boolean): Promise<void>

	loading_folder_ids: Set<string>
	is_folder_loading(folder_id: string): boolean
	/** Set while `open_folder` awaits the fetch; drives the header loading spinner. */
	opening_folder_id: string | null

	/** Normalized folder cache: single source of truth for folder data. */
	folders: Record<string, FolderWithChildrenXattrs>
	/** Canvas ink per folder, sorted by z; filled lazily by ensure_strokes. */
	strokes_by_folder: Record<string, StrokeNode[]>
	/** Canvas edges per folder; filled lazily by ensure_connections. */
	connections_by_folder: Record<string, Connection[]>
	/** Open folder tabs of this workspace; at least one tab always exists. */
	tabs: WorkspaceTab[]
	active_tab_id: string
	get active_tab(): WorkspaceTab
	/** Delegates to the active tab's folder_id. */
	opened_folder_id: string
	/** Derived view over `folders`, kept for compatibility. */
	get opened_folder(): FolderWithChildrenXattrs
	/** Derived view over `folders` (everything except the opened folder). */
	get preview_folders(): Record<string, FolderWithChildrenXattrs>
	get folder_container(): FolderContainerWidget
	resolve_folder_data(folder_id: string): FolderWithChildrenXattrs | null
	ensure_preview_folder(folder_id: string): Promise<void>
	prefetch_preview_folders(entries: FolderWithChildrenXattrs['children']): Promise<void>
	is_opened_folder(folder_id: string): boolean

	/** Stack of previously opened folder ids for browser-like back navigation (active tab's history). */
	folder_back_stack: string[]
	get can_go_back(): boolean
	go_back(): Promise<void>

	/** Opens a folder in a new tab and activates it. */
	open_folder_in_new_tab(folder_id: string): Promise<void>
	/** Switches to an existing tab, refetching its folder. */
	activate_tab(tab_id: string): Promise<void>
	/** Closes a tab; no-op for the last remaining tab. Activates a neighbor if the closed tab was active. */
	close_tab(tab_id: string): Promise<void>

	show_folder_children(folder_id: string, should_apply?: () => boolean): Promise<void>
	open_folder(folder_id: string, options?: { fromBack?: boolean; skipHistory?: boolean }): Promise<void>
	/**
	 * Shared navigation body (fetch, cache, watch, sidebar expand) used by
	 * open_folder / go_back / tab methods. `force` refetches the current folder.
	 */
	navigate_open_folder(
		folder_id: string,
		options?: { fromBack?: boolean; skipHistory?: boolean; force?: boolean },
	): Promise<void>
	open_file(id: string): Promise<void>
	/** Copies external filesystem paths into the currently opened folder. Local/demo only. */
	import_external_files(paths: string[], position?: Position): Promise<void>
	/** Imports browser File objects (picker / drag & drop) into the given folder. */
	import_files(folder_id: string, files: File[], position?: Position): Promise<void>
	/** Byte-level progress of the running `import_files`, null when idle. */
	import_progress: ImportProgress | null
	create_folder(
		folder_id: string,
		position?: Position,
		options?: { view?: FolderView },
	): Promise<string>
	/**
	 * Moves all children of `folder_id` into its parent, then removes the folder.
	 * No-op for the workspace root.
	 */
	uncombine_folder(folder_id: string): Promise<void>
	create_text_file(folder_id: string, position?: Position): Promise<void>
	create_markdown_file(folder_id: string, position?: Position): Promise<void>
	rename(id: string, new_name: string): Promise<void>
	move(id: string, target_folder_id: string, new_index: number, source_folder_id?: string, source_index?: number): Promise<string | undefined>
	remove(id: string): Promise<void>

	// opened folder
	change_folder_view(folder_id: string, new_view: FolderView): Promise<void>
	change_selected_slide_index(folder_id: string, index: number): Promise<void>
	change_snap_to_grid(folder_id: string, snap_to_grid: boolean): Promise<void>
	change_grid_size(folder_id: string, grid_size: number): Promise<void>
	change_show_grid_dots(folder_id: string, show_grid_dots: boolean): Promise<void>
	change_show_axes(folder_id: string, show_axes: boolean): Promise<void>

	// canvas ink: entity-level per-stroke storage (see fm.strokes)
	strokes_for(folder_id: string): StrokeNode[]
	ensure_strokes(folder_id: string): Promise<void>
	upsert_strokes(folder_id: string, strokes: StrokeNode[]): Promise<void>
	delete_strokes(folder_id: string, stroke_ids: string[]): Promise<void>

	// canvas edges: entity-level per-connection storage (see fm.connections)
	connections_for(folder_id: string): Connection[]
	ensure_connections(folder_id: string): Promise<void>
	upsert_connections(folder_id: string, connections: Connection[]): Promise<void>
	delete_connections(folder_id: string, connection_ids: string[]): Promise<void>
	/** Folder ids with a loaded connections cache (persistCanvas helpers). */
	connections_folder_ids(): string[]
	/** Rekeys the connections cache for a renamed/moved folder subtree. */
	rekey_connections(old_id: string, new_id: string): void
	change_background(id: string, new_background: ImageBase64 | Color): Promise<void>
	change_shape_fill(id: string, color: Color): Promise<void>
	change_line_geometry(
		id: string,
		geometry: {
			position: Position
			size: Size
			flipX: boolean
			flipY: boolean
			axis?: LineAxis
			startPlug?: LinePlug
			endPlug?: LinePlug
		},
	): Promise<void>
	change_line_plugs(
		id: string,
		plugs: {
			startPlug: LinePlug
			endPlug: LinePlug
		},
	): Promise<void>
	change_cover(id: string, new_cover: Color): Promise<void>
	change_position(id: string, new_position: Position): Promise<void>
	change_size(id: string, new_size: Size): Promise<void>
	change_model_camera(id: string, state: ModelCameraState): Promise<void>
	change_is_preview(id: string, is_preview: boolean): Promise<void>
	/** Re-read a folder from disk and refresh cache + sidebar tree projection. */
	reload_folder_cache(folder_id: string): Promise<void>
	/**
	 * Runs a multi-step fs mutation with desktop watch refreshes suppressed.
	 * The callback should finish with reload_folder_cache for affected folders.
	 */
	run_batch_fs_update<T>(fn: () => Promise<T>): Promise<T>
	/** Shallow-clone a cached folder so Vue recomputes embedded previews. */
	touch_folder(folder_id: string): void
	reorder_children(folder_id: string, ordered_ids: string[]): Promise<void>
	create_note(folder_id: string, position?: Position): Promise<string>
	create_shape(folder_id: string, template: ShapeTemplate, position?: Position): Promise<string>
	/** Creates a line/arrow shape spanning two absolute pane points. */
	create_line(folder_id: string, start: Position, end: Position, end_plug?: LinePlug): Promise<string>
	read_note_content(id: string): Promise<string>
	get_media_src(id: string, filename: string): Promise<MediaSrc>
	save_note_content(id: string, new_content: string): Promise<void>

	open(widget: FolderContainerWidgetChild): void

} & SelectionStore & ClipboardStore

export interface SelectionStore {
	selection: string[]
	selection_mode: boolean
	select(id: string): void
	deselect(id: string): void
	clear_selection(): void
	set_selection(ids: string[]): void
	is_selected(id: string): boolean
	toggle_selection(id: string): void
	enter_selection_mode(): void
	exit_selection_mode(): void
	can_select_with_click(event?: { shiftKey?: boolean }): boolean
}

export type ClipboardMode = 'copy' | 'cut'

export type ClipboardState = {
	mode: ClipboardMode
	source_folder_id: string
	entry_ids: string[]
} | null

export interface ClipboardStore {
	clipboard: ClipboardState
	copy_entries(ids: string[]): void
	cut_entries(ids: string[]): void
	clear_clipboard(): void
	is_cut(id: string): boolean
	/**
	 * Pastes into `opened_folder_id`.
	 * Copy may paste into the source folder (unique names).
	 * Cut is a no-op in the source folder.
	 */
	paste(): Promise<void>
	/** Duplicates entries into `opened_folder_id` with unique names (no clipboard). */
	duplicate_entries(ids: string[]): Promise<void>
}

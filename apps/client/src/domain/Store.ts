import type { WorkspacesListItem, WorkspaceType } from '@/domain/WorkspacesList'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import type { ShapeTemplate } from '@/domain/shapes'
import type { LinePlug, LineAxis } from '@/services/board/shapes'
import type { EntryContentCaches } from '@/ui/workspace/folder-container/textContentCache'
import type { MediaSrcCache } from '@/ui/workspace/folder-container/media/mediaSrcCache'
import { Color, Connection, DashboardCell, FolderContainerWidget, FolderContainerWidgetChild, FolderView, ImageBase64, ModelCameraState, Position, Size, StrokeNode } from './Widget'
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
	 * The folder the opening navigation goes to: read alongside the root, so
	 * a deep link does not wait for two reads in a row
	 */
	also_read?: string
}

/** A picture's upload the look attribute waits for (true: uploaded) */
export type LookWriteOptions = { after?: Promise<boolean> }

export
type Store = {
	is_workspace_loading: boolean
	/** Message of the last failed root-level operation (e.g. workspace load). */
	last_error: string | null
	clear_error(): void
	/**
	 * Exports the open local or cloud workspace (or `ws`, e.g. the Explorer's
	 * cloud folder) to a `.pile` archive. A local folder is desktop only. A
	 * cloud workspace is handed to `download_public_workspace`.
	 */
	export_current_workspace(ws?: WorkspaceStore): Promise<void>
	/**
	 * Writes a cloud workspace out as a `.pile`: a save dialog in the desktop
	 * app, a browser download on the web. The dialog suggests the workspace
	 * name plus `.pile`, unchanged; the web download replaces characters a
	 * file system refuses. A public board uses this when its author allows
	 * forks and downloads — a signed-in visitor, and the originals are charged
	 * to them. A member exporting a cloud folder they can open uses it too.
	 */
	download_public_workspace(ws: WorkspaceStore): Promise<void>
	/** Unpacks a `.pile` into a chosen folder. The new folder, or null when cancelled or failed.
	 * When `pile_path` is set (Open With / double-click), skips the file picker.
	 */
	unpack_workspace_pack(pile_path?: string): Promise<{ root: string; name: string } | null>
	load_workspace(ws: WorkspacesListItem, opts?: LoadWorkspaceOptions): Promise<void>
	/** Closes the open workspace (e.g. after its cloud workspace was removed). */
	close_workspace(): void
	workspace: WorkspaceStore | null
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
	 * The file manager can store a cover or background picture in `.pile`.
	 * Menus offer the file picker only when this is true.
	 */
	pile_images: boolean

	/**
	 * False for a public-link visitor without membership: the board was read
	 * once and the store holds no realtime subscription, so it does not change
	 * until a reload.
	 */
	live: boolean

	/** Message of the last failed fs operation; UI may show and reset it. */
	last_error: string | null
	clear_error(): void
	/**
	 * A dot-named entry was just created or renamed while Show hidden files
	 * is off. The window shows it as a neutral toast and clears it.
	 */
	hidden_notice: string | null
	clear_hidden_notice(): void

	/** Stops the FS watcher. Called when replacing or unloading the workspace. */
	dispose(): void
	/** True after `dispose()`. A closed store must not be reused. */
	is_disposed: boolean

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
	/** The open folder shows what was kept (memory or this device) while the cloud is read again */
	refreshing_folder_id: string | null

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

	/**
	 * Reads a tree folder's children. A failed read sets `last_error`;
	 * `silent: true` throws it to the caller instead, e.g. a background
	 * look-ahead that must not toast for every unreadable folder.
	 * `refresh: true` reads it again even when it is cached: a collapsed
	 * folder is not watched in the Explorer, so its cache may be stale.
	 */
	show_folder_children(
		folder_id: string,
		should_apply?: () => boolean,
		options?: { silent?: boolean; refresh?: boolean },
	): Promise<void>
	/** Resolves `false` when a later open or `cancel_open` took over: nothing of this one was shown */
	open_folder(folder_id: string, options?: { fromBack?: boolean; skipHistory?: boolean }): Promise<boolean>
	/**
	 * Shared navigation body (fetch, cache, watch, sidebar expand) used by
	 * open_folder / go_back / tab methods. `force` refetches the current folder.
	 * Each call supersedes the one in flight: the slower one does not apply
	 * its folder and resolves `false`.
	 */
	navigate_open_folder(
		folder_id: string,
		options?: { fromBack?: boolean; skipHistory?: boolean; force?: boolean },
	): Promise<boolean>
	/** Drops the open in flight: its folder is not applied (the Explorer left for another place) */
	cancel_open(): void
	/** Opens a file: in the note editor when the open-file hook takes it, else in the system's program. */
	open_file(id: string): Promise<void>
	/** Opens a file in the system's program (or the browser), whatever the hook would do. */
	open_file_externally(id: string): Promise<void>
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
	/**
	 * `report: false` throws a failed rename to the caller instead of
	 * setting `last_error` (which the window shows as a toast): a batch
	 * reports its failures itself.
	 */
	rename(id: string, new_name: string, options?: { report?: boolean }): Promise<void>
	move(id: string, target_folder_id: string, new_index: number, source_folder_id?: string, source_index?: number): Promise<string | undefined>
	remove(id: string): Promise<void>

	// opened folder
	// A look change (view, cover, icon, background) shows at once and is written
	// in the background; the promise settles with the write. A failed write puts
	// back what the backend has and reports the error
	change_folder_view(folder_id: string, new_view: FolderView): Promise<void>
	/**
	 * The folder's own cover: a color, a picture link, or a local `pile:` image. Written on the folder itself, as its view.
	 * `after`: a picture's upload; the attribute is written only once it succeeded
	 */
	change_folder_cover(folder_id: string, cover: string, options?: LookWriteOptions): Promise<void>
	/** The folder's own icon, "<name>;<color>" ("none" clears it). Written on the folder itself */
	change_folder_icon(folder_id: string, icon: string): Promise<void>
	change_selected_slide_index(folder_id: string, index: number): Promise<void>
	change_snap_to_grid(folder_id: string, snap_to_grid: boolean): Promise<void>
	change_grid_size(folder_id: string, grid_size: number): Promise<void>
	change_show_grid_dots(folder_id: string, show_grid_dots: boolean): Promise<void>
	change_show_axes(folder_id: string, show_axes: boolean): Promise<void>
	change_dashboard_cell(id: string, cell: DashboardCell): Promise<void>
	change_dashboard_compact(folder_id: string, compact: boolean): Promise<void>
	change_masonry_column_width(folder_id: string, width: number): Promise<void>
	/** `0` is Auto: as many columns as fit. */
	change_masonry_columns(folder_id: string, columns: number): Promise<void>

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
	change_background(id: string, new_background: ImageBase64 | Color, options?: LookWriteOptions): Promise<void>
	/** Image heading (`title`) or caption (`description`). An empty value removes the xattr. */
	set_image_text(id: string, field: 'title' | 'description', value: string): Promise<void>
	/** A shape's text, as markdown; empty removes it. */
	set_shape_text(id: string, markdown: string): Promise<void>
	set_shape_text_area(id: string, area: 'frame' | null): Promise<void>
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
	/** Draws a note file as a bare text block (or back as a note). The preview, fill and size stay as they are. */
	change_is_text(id: string, is_text: boolean): Promise<void>
	/** A text block's width mode: "fixed" after a side handle drag, "auto" to grow with the text again. */
	change_text_width(id: string, mode: 'auto' | 'fixed'): Promise<void>
	/**
	 * A file cover becomes a text block in one write: preview on, text on, and
	 * the default text size when the entry has none.
	 */
	show_as_text(id: string): Promise<void>
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
	/** A `Text N.md` note file drawn as a bare text block. It comes back selected. */
	create_text(folder_id: string, position?: Position): Promise<string>
	create_shape(folder_id: string, template: ShapeTemplate, position?: Position): Promise<string>
	/** Creates a line/arrow shape spanning two absolute pane points. */
	create_line(folder_id: string, start: Position, end: Position, end_plug?: LinePlug): Promise<string>
	read_note_content(id: string): Promise<string>
	/** `preview`: a tile asks for the image's ready preview instead of the original */
	get_media_src(id: string, filename: string, options?: { preview?: boolean }): Promise<MediaSrc>
	save_note_content(id: string, new_content: string): Promise<void>

	open(widget: FolderContainerWidgetChild): void
	/** The Explorer opens folders from views through its navigation; null: the store opens them itself */
	set_open_folder_hook(hook: ((folder_id: string) => unknown) | null): void
	/** The Explorer opens notes in its editor: true when the hook took the file; null: every file opens outside */
	set_open_file_hook(hook: ((file_id: string) => boolean) | null): void

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

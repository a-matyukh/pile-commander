type Entry = {
	id: string
	name: string
	type: "file" | "folder"
}

export type Xattr = {
	name: string
	value: string
}

export type EntryWithXattrs = Entry & {
	xattrs: Xattr[]
}

export type FolderChild = Entry

type FolderChildPatch = Pick<FolderChild, "id" | "name">

export type FolderWithChildrenXattrs = EntryWithXattrs & {
	type: "folder"
	children: EntryWithXattrs[]
}

/**
 * What a URL serves. A public-board visitor (not a member) gets a preview
 * once the backend made one: `thumb` is a smaller image, `poster` a still of
 * a video — an image, not a playable file. Members always get `original`
 */
export type MediaVariant = "original" | "thumb" | "poster"

export type MediaSrc = {
	url: string
	revoke?: () => void
	/**
	 * Epoch ms after which the URL stops working (presigned cloud URLs);
	 * absent for blob:/local URLs that never expire. Caches must re-acquire
	 * instead of handing out a dead URL
	 */
	expires_at?: number
	/** absent = the original (local files, text payloads, members) */
	variant?: MediaVariant
}

/** Byte-level upload progress: `loaded` of `total` bytes sent so far. */
export type UploadProgressCallback = (loaded: number, total: number) => void

/**
 * PUTs bytes to a presigned storage URL. The desktop shell supplies one: its
 * release origin is `tauri://localhost`, and B2's CORS only reflects http(s)
 * origins, so a PUT from the webview never finishes.
 */
export type PutBlob = (
	url: string,
	content_type: string,
	data: Blob,
	on_progress?: UploadProgressCallback,
) => Promise<void>

/**
 * `resync`: live updates resumed after a gap (e.g. a realtime rejoin) —
 * events of the gap may be lost, so the watched folder must be re-read;
 * `ids` holds the watched folder.
 */
export type WatchEventKind = 'create' | 'modify' | 'remove' | 'rename' | 'other' | 'resync'

export type WatchEvent = {
	kind: WatchEventKind
	ids: string[]
}

export type Unwatch = () => void

/**
 * One canvas ink stroke of a folder. Entity-level record: a pen commit is
 * one upsert, the eraser a delete, a drag an upsert of the moved strokes.
 * `z` replaces the former array index — strokes render ascending.
 */
export type FolderStroke = {
	id: string
	z: number
	position: { x: number; y: number }
	/** Points relative to `position`, quantized to 0.01. */
	points: { x: number; y: number }[]
	color: string
	stroke_width: number
	width: number
	height: number
}

export type StrokesWatchEvent = {
	upserted: FolderStroke[]
	deleted: string[]
	/** Live updates resumed after a gap: events may be lost, re-list the folder. */
	resync?: true
}

/**
 * Per-folder ink storage. Cloud: the `folder_strokes` table (per-row
 * realtime). Local: the `.pile/strokes.json` sidecar file. The interface
 * hides the storage format so sync logic is shared across backends.
 */
export interface FolderStrokesStore {
	list_strokes(folder_id: string): Promise<FolderStroke[]>
	upsert_strokes(folder_id: string, strokes: FolderStroke[]): Promise<void>
	delete_strokes(folder_id: string, stroke_ids: string[]): Promise<void>
	watch_strokes(
		folder_id: string,
		on_event: (event: StrokesWatchEvent) => void,
	): Promise<Unwatch>
}

export type ConnectionHandle = 'top' | 'right' | 'bottom' | 'left'

/** Vue Flow MarkerType values; undefined = no marker. */
export type ConnectionMarker = 'arrow' | 'arrowclosed'

/**
 * One canvas edge between two children of a folder. Entity-level record:
 * a connect is one upsert, edge removal a delete, a marker/animation
 * toggle an upsert. The id is deterministic (`from:handle-to:handle`),
 * so concurrent clients creating the same edge dedup on the id.
 */
export type FolderConnection = {
	id: string
	from: string
	to: string
	from_handle?: ConnectionHandle
	to_handle?: ConnectionHandle
	marker_start?: ConnectionMarker
	marker_end?: ConnectionMarker
	is_animated: boolean
	/** Mid-edge caption; omitted or empty means no visible label. */
	label?: string
}

export type ConnectionsWatchEvent = {
	upserted: FolderConnection[]
	deleted: string[]
	/** Live updates resumed after a gap: events may be lost, re-list the folder. */
	resync?: true
}

/**
 * Per-folder canvas edge storage. Cloud: the `folder_connections` table
 * (per-row realtime). Local: the `.pile/connections.json` sidecar file.
 * The interface hides the storage format so sync logic is shared across
 * backends.
 */
export interface FolderConnectionsStore {
	list_connections(folder_id: string): Promise<FolderConnection[]>
	upsert_connections(folder_id: string, connections: FolderConnection[]): Promise<void>
	delete_connections(folder_id: string, connection_ids: string[]): Promise<void>
	watch_connections(
		folder_id: string,
		on_event: (event: ConnectionsWatchEvent) => void,
	): Promise<Unwatch>
}

/**
 * Abstraction over workspace filesystem operations.
 *
 * **Identity contract:** `id` is the absolute filesystem path of the entry.
 * `rename` and `move` change the path and therefore return a new `id`.
 * Callers that cache entries by id (e.g. vue-elm `apply_id_changed`) must
 * treat every successful rename/move as an id change, not an in-place update.
 */
export type CreateFolderOptions = { xattrs?: Record<string, string> }
export type CreateTextFileOptions = CreateFolderOptions & { content?: string }

export
interface FileManager {
	FolderChildren(folder_id: string): Promise<FolderChild[]>

	open_file(id: string): Promise<void>
	/**
	 * `options` are written together with the entry, so a watcher never sees
	 * it without them (cloud: one INSERT; a board note is born positioned)
	 */
	create_folder(folder_id: string, folder_name: string, options?: CreateFolderOptions): Promise<FolderChild>
	create_text_file(folder_id: string, filename: string, options?: CreateTextFileOptions): Promise<FolderChild>
	read_text_file(id: string): Promise<string>
	/**
	 * `original`: the file itself where a public-board visitor would be served a
	 * preview (Download as .pile). The backend signs it only for a signed-in
	 * caller, where the author allows forks and downloads, and charges the
	 * caller's own download allowance
	 */
	get_media_src(id: string, options?: { mimeType?: string; original?: boolean }): Promise<MediaSrc>
	save_text_file(id: string, content: string): Promise<void>
	/**
	 * Imports a file from bytes (drag & drop, browser file picker, OS import
	 * after reading it into memory). Implementations route by mime: text-like
	 * files may go to text storage (cloud content column), binaries to blob
	 * storage (cloud B2) or a plain write to disk (local).
	 */
	upload_file(folder_id: string, filename: string, data: Blob, mime?: string, onProgress?: UploadProgressCallback): Promise<FolderChild>
	/** Renames within the same parent; returned `id` is the new path. */
	rename(id: string, new_name: string): Promise<FolderChildPatch>
	/** Moves (and optionally renames); returned `id` is the new path. */
	move(id: string, target_folder_id: string, new_name?: string): Promise<FolderChildPatch>
	/** Copies a file into `target_folder_id`; returned child uses the destination path. */
	copy_file(source_path: string, target_folder_id: string, new_name?: string): Promise<FolderChild>
	/**
	 * Copies a file or folder (recursively) into `target_folder_id`.
	 * Returned child uses the destination path.
	 */
	copy_entry(source_path: string, target_folder_id: string, new_name?: string): Promise<FolderChild>
	remove(id: string): Promise<void>
	/** Payload size in bytes (text or blob); 0 for folders. */
	entry_size(id: string): Promise<number>

	set_xattr(id: string, name: string, value: string): Promise<void>
	/**
	 * Merges attributes into many entries at once: bulk layout writes (a
	 * `.pile` import, the cloud bridge copy). Entries that are gone, or whose
	 * attributes would outgrow the backend's size cap, come back in `missing`
	 * instead of failing the batch. Each id appears at most once.
	 */
	set_xattrs(items: { id: string; xattrs: Record<string, string> }[]): Promise<{ missing: string[] }>
	get_xattr(id: string, name: string): Promise<string | null>
	remove_xattr(id: string, name: string): Promise<void>
	list_xattrs(id: string): Promise<Xattr[]>
	folder_with_children_xattrs(id: string): Promise<FolderWithChildrenXattrs>

	/** Canvas ink: entity-level per-folder stroke storage. */
	strokes: FolderStrokesStore

	/** Canvas edges: entity-level per-folder connection storage. */
	connections: FolderConnectionsStore

	watch(
		folder_id: string,
		on_event: (event: WatchEvent) => void,
		options?: { recursive?: boolean; delay_ms?: number },
	): Promise<Unwatch>
}

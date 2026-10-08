/**
 * Two-way sync of a workspace folder on disk with a cloud workspace
 * (LOCAL_SYNC.md, LOCAL_SYNC_PHASE2.md). Every pass compares three trees: the
 * base (what both sides held after the last good pass), the folder on disk
 * and the cloud workspace, and carries each side's changes to the other.
 * Nothing is overwritten blindly: a file changed on both sides keeps the
 * cloud version under its name and the local one as a conflicted copy.
 */

export const SYNC_STATE_VERSION = 1

/** One entry as of the last good pass. */
export type BaseEntry = {
	kind: 'file' | 'folder'
	/** Local size and mtime: a change of either counts as a local edit. */
	size: number
	mtime_ms: number
	/** Cloud row the entry is linked to (entries.id). */
	cloud_id: string
	/** Cloud content mtime then (entries.content_modified_at, or updated_at for folders). */
	cloud_modified_at: string | null
	/** Hash of the local xattrs last pushed; absent = never pushed. */
	xattrs_hash?: string
}

/** Ink and edges of a folder as last pushed (hashes of the local records). */
export type BaseFolderLayout = {
	strokes_hash: string
	connections_hash: string
}

/** `<root>/.pile/sync.json` — the link and the base snapshot. */
export type SyncState = {
	version: number
	workspace_id: string
	user_id: string
	/** The device and folder that own the link: a copied folder is not linked. */
	device_id: string
	root_path: string
	/** Relative paths the person left out (heavy files over the plan). */
	exclude: string[]
	/**
	 * A link to a cloud copy made earlier: cloud rows untouched since then
	 * (content mtime up to this epoch ms) hold the old local content.
	 */
	adopt_before?: number
	entries: Record<string, BaseEntry>
	layout: Record<string, BaseFolderLayout>
	root_xattrs_hash?: string
	last_synced_at?: number
}

export type LocalEntry = {
	/** Path under the root, '/'-separated. */
	relative: string
	/** The local file manager's id (absolute path). */
	id: string
	name: string
	kind: 'file' | 'folder'
	size: number
	mtime_ms: number
	/** The cloud refuses this name or a parent folder's name. */
	bad_name: boolean
}

export type CloudEntry = {
	id: string
	parent_id: string | null
	path: string
	name: string
	kind: 'file' | 'folder'
	size: number
	/** Content mtime; folders, whose content never changes, carry updated_at. */
	modified_at: string | null
	/** Text payloads live in a column and update in place; blobs do not. */
	is_blob: boolean
	xattrs: Record<string, string>
}

export type SkipReason = 'bad_name' | 'too_large' | 'excluded' | 'parent_skipped' | 'kind_clash' | 'occupied'

export type SyncAction =
	// ---- here → cloud ----
	/** A new folder here (or one deleted in the cloud that still holds something new here). */
	| { kind: 'create_folder'; relative: string }
	/** A new file here, or one deleted in the cloud and edited here. */
	| { kind: 'upload'; relative: string }
	/** Edited here over an unchanged cloud row. */
	| { kind: 'update'; relative: string; cloud_id: string }
	/** Renamed or moved here: the cloud row follows, keeping its id, layout and edges. */
	| { kind: 'move'; from: string; relative: string; cloud_id: string }
	/** Deleted here and unchanged in the cloud: the cloud row goes to the cloud trash. */
	| { kind: 'delete'; relative: string; cloud_id: string }
	// ---- cloud → here ----
	/** A folder new in the cloud (or deleted here while the cloud added to it). */
	| { kind: 'download_folder'; relative: string; cloud_id: string }
	/** New or edited in the cloud and unchanged here (or deleted here, edited there): the cloud bytes come down. */
	| { kind: 'download'; relative: string; cloud_id: string }
	/** Renamed or moved in the cloud: the file or folder here follows. */
	| { kind: 'local_move'; from: string; relative: string; cloud_id: string }
	/** Deleted in the cloud and unchanged here: the file or folder goes to the system trash. */
	| { kind: 'local_trash'; relative: string }
	// ---- both ----
	/**
	 * Changed on both sides (or different files at one path): the cloud version
	 * keeps the name. The local file is renamed to a conflicted copy, goes up
	 * as a new file, and the cloud version comes down under the name
	 */
	| { kind: 'local_conflict'; relative: string; cloud_id: string }
	/** The cloud already holds this entry (a linked earlier copy, a resumed pass). */
	| { kind: 'adopt'; relative: string; cloud_id: string }
	/** Gone on both sides: the link is dropped. */
	| { kind: 'forget'; relative: string }
	| { kind: 'skip'; relative: string; reason: SkipReason }

export type SyncPlan = {
	actions: SyncAction[]
	/** Base files a pass would move to the cloud trash. */
	deletes: number
	/** Base files a pass would move to the system trash here. */
	local_deletes: number
	/** Base files before the pass. */
	base_files: number
}

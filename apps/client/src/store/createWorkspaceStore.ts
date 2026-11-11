import { markRaw, reactive, watch } from 'vue'
import makeSelection from './selection'
import makeClipboard from './clipboard'
import {
	find_tree_node,
	find_tree_parent,
	find_folder_id_for_list,
	is_descendant,
	folder_ancestor_chain,
	folder_children_list,
	parent_folder_id_from_node_id,
	project_tree,
	sync_tree_from_folders,
} from '../services/workspace/tree'
import {
	apply_entry_created,
	apply_entry_removed,
	apply_id_changed,
	find_child_entry,
	note_hidden_name,
	note_hidden_names,
	type WorkspaceState,
} from '../services/workspace/mutations'
import { path_separator } from '../services/workspace/paths'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { note_cloud_root_look } from '@/store/cloud'
import type { ClipboardState, HistoryOptions, LookWriteOptions, WorkspaceStore, WorkspaceTab, ImportProgress } from '../domain/Store'
import { history, entries_label, entry_name, own_action } from './history'
import type { CreateStep, DeleteStep, HistoryStoreRef, HistoryTx } from './history/types'
import { path_name, rebase_path } from './history/steps'
import { synced_folders, type SyncedEntry } from './history/synced'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import {
	active_step,
	FolderWithChildrenXattrs,
	type ConnectionsWatchEvent,
	type FileManager,
	type FolderChild,
	type RemoveReceipt,
	type RestoreRemovedResult,
	type StrokesWatchEvent,
	type UntouchedExpect,
	type Xattr,
	type Unwatch,
	type WatchEvent,
} from '@pile-commander/file-manager'
import { folder_stroke_to_node, node_to_folder_stroke } from '@/services/canvas/strokes'
import {
	connection_to_folder_connection,
	folder_connection_to_connection,
} from '@/services/canvas/connections'
import {
	to_folder_container,
	collect_preview_folder_ids,
	children_orders_match,
	complete_visible_order,
} from '../services/workspace/folderContainer'
import { hidden_paths } from './hiddenPaths'
import { show_hidden_files } from './showHiddenFiles'
import { persist_xattr, persist_xattr_now, clear_xattr, show_xattr_locally, find_entry_owner_folder, xattrs_map, upsert_folder_xattr, notify_entry_xattr_changed, apply_pending_entry_xattrs, bump_folder_cache_generation } from '../services/workspace/xattrs'
import { image_text_from_stored, type ImageTextField } from '../services/workspace/imageText'
import { shape_template_svg, apply_shape_color, prepare_svg_for_preview, parse_line_meta, build_line_svg, is_line_shape, line_layout_from_endpoints, SHAPE_LINE_DEFAULT_STROKE, LINE_STROKE_WIDTH, type LinePlug, type LineAxis } from '../services/board/shapes'
import {
	invalidate_entry_content_caches,
	rekey_entry_content_caches,
	createEntryContentCaches,
	type EntryContentCaches,
} from '@/ui/workspace/folder-container/textContentCache'
import { createMediaSrcCache } from '@/ui/workspace/folder-container/media/mediaSrcCache'
import {
	resolve_folder_name,
	resolve_markdown_file_name,
	resolve_note_filename,
	resolve_shape_filename,
	resolve_text_block_filename,
	resolve_text_file_name,
	resolve_unique_filename,
} from '../services/naming/uniqueName'
import type { ShapeTemplate } from '@/domain/shapes'
import {
	Color,
	Connection,
	FolderContainerWidgetChild,
	DashboardCell,
	Floor3D,
	floor_3d_from_stored,
	Option3D,
	FolderView,
	ImageBase64,
	ModelCameraState,
	Position,
	Size,
	StrokeNode,
	stored_folder_view,
} from '@/domain/Widget'
import { board_position, board_quadrant_shift, board_size, absolute_from_origin, read_position_attr, FOLDER_PREVIEW_DEFAULT_SIZE, SHAPE_LINE_DEFAULT_SIZE, SHAPE_SQUARE_DEFAULT_SIZE, TEXT_DEFAULT_SIZE } from '@/services/board/layout'
import { get_mime_type } from '@/services/board/media'
import { basename } from '@tauri-apps/api/path'
import { report_error } from './helpers/reportError'
import { user_message_for_watch_error } from './helpers/watchSubscribeError'
import { read_paths_as_files } from '@/services/workspace/pathsToFiles'
import { find_widget, widget_folder_data } from './helpers/widgetHelpers'
import { persist_children_order } from './helpers/persistChildrenOrder'
import { sort_entries_by_order_then_name } from '@/services/workspace/folderContainer'
import {
	move_folder_canvas_connections,
	prune_folder_canvas_connections,
	rename_folder_canvas_connections,
	type CanvasPersistStore,
} from './helpers/persistCanvas'
import { count_items, t } from '@/i18n'
import { hold_entry } from '@/services/cloud/pendingEntries'
import {
	cached_folders_affected_by,
	folder_read_ticket,
	refresh_cached_folder,
	reread_event,
} from './helpers/refreshCachedFolder'
import { is_interrupted_error, is_missing_path_error, page_visible } from './helpers/fsErrors'
import {
	batch_fs_update_active,
	run_batch_fs_update as run_batch_fs_update_impl,
	maybe_sync_tree_from_folders,
} from '../services/workspace/batchFsUpdate'
import { create_entry } from './helpers/createEntry'
import { copy_entries_into } from './helpers/copyEntriesInto'
import { transfer_entries } from './helpers/crossStoreTransfer'
import { entry_clipboard } from './entryClipboard'

type PersistXattrStore = {
	folders: Record<string, FolderWithChildrenXattrs>
	preview_folders: Record<string, FolderWithChildrenXattrs>
	last_error: string | null
	history_ref?: HistoryStoreRef | null
}

function xattr_hooks(store: PersistXattrStore, owner_id: string) {
	return {
		resolve_folder: () => store.folders[owner_id],
		replace_folder: (next: FolderWithChildrenXattrs) => {
			store.folders[owner_id] = next
		},
	}
}

/** A write that is a step of the person's action: `before` is the stored value it replaces (null: not set) */
type AttrRecord = { tx?: HistoryTx; before: string | null }

/** The stored value of one attribute in a cached folder: the folder's own, or a child's */
function raw_xattr(folder: FolderWithChildrenXattrs | null | undefined, id: string, name: string): string | null {
	if (!folder) return null
	const holder = folder.id === id ? folder : folder.children?.find(child => child.id === id)
	return holder?.xattrs.find(xattr => xattr.name === name)?.value ?? null
}

/**
 * A saved attribute write: a step of the person's action when it has `tx`;
 * otherwise the app's own write (a text block growing with its text), which
 * updates the nearest step about the same attribute instead
 */
function note_attr_write(
	store: PersistXattrStore,
	id: string,
	name: string,
	before: string | null,
	after: string | null,
	look: boolean,
	tx: HistoryTx | undefined,
) {
	if (tx) tx.record({ kind: 'attr', id, name, before, after, look })
	else history.amend_attr(store.history_ref, id, name, after)
}

/**
 * An action the history cannot undo yet (a file operation, a picture): undo
 * stops before it and says so instead of undoing something older. Only the
 * Explorer's stores keep a history
 */
function block_history(store: { history_ref?: HistoryStoreRef | null }, label: string) {
	if (store.history_ref) history.barrier(label)
}

/** A value that names a picture, not a color: undo cannot bring one back yet (old pictures are swept) */
function is_picture_value(value: string | null | undefined): boolean {
	return !!value && /^(pile:|data:|blob:|https?:|url\()/i.test(value.trim())
}

/** Where the edges to a removed entry live: its folder, or the parent of the open folder itself */
/**
 * A paste onto a board: the board cannot show what sits left of or above it,
 * so entries pasted from a canvas at negative coordinates move in together,
 * keeping their arrangement (as a canvas → board drop does).
 */
async function fit_pasted_on_board(
	store: WorkspaceStore,
	folder_id: string,
	ids_before: Set<string>,
	tx?: HistoryTx,
) {
	const folder = store.resolve_folder_data(folder_id)
	if (!folder) return
	if (to_folder_container(folder, store.preview_folders).view !== 'board') return

	const pasted: Array<{ id: string; position: Position }> = []
	for (const child of folder.children ?? []) {
		if (ids_before.has(child.id)) continue
		const position = read_position_attr(xattrs_map(child.xattrs).position)
		if (position) pasted.push({ id: child.id, position })
	}
	const shift = board_quadrant_shift(pasted.map(entry => entry.position))
	if (shift.x === 0 && shift.y === 0) return

	for (const entry of pasted) {
		await store.change_position(entry.id, {
			x: entry.position.x + shift.x,
			y: entry.position.y + shift.y,
		}, { tx })
	}
}

function removed_owner_folder_id(store: WorkspaceStore, id: string): string | undefined {
	const owner_folder = find_entry_owner_folder(store.opened_folder, store.preview_folders, id)
	return owner_folder?.id === id ? parent_folder_id_from_node_id(id, store.id) : owner_folder?.id
}

/** Whether a cached entry is a folder: what a delete step keeps of it */
function cached_entry_type(store: WorkspaceStore, id: string): 'file' | 'folder' {
	const owner_folder = find_entry_owner_folder(store.opened_folder, store.preview_folders, id)
	if (owner_folder?.id === id || store.folders[id]) return 'folder'
	return owner_folder?.children?.find(child => child.id === id)?.type === 'folder' ? 'folder' : 'file'
}

/** The synced folder and cloud row of a local entry (desktop): its undo writes both sides */
async function locate_synced(store: WorkspaceStore, id: string): Promise<SyncedEntry | undefined> {
	if (store.type !== 'local') return undefined
	return (await synced_folders()?.locate(id).catch(() => null)) ?? undefined
}

/** Something is at `id` now */
async function entry_there(fm: FileManager, id: string, root_id: string): Promise<boolean> {
	const siblings = await fm.FolderChildren(parent_folder_id_from_node_id(id, root_id)).catch(() => [])
	return siblings.some(child => child.id === id)
}

/** The edges of a folder's board that end at `id`: they go when it goes */
function edges_to(store: WorkspaceStore, folder_id: string, id: string): Connection[] {
	return store.connections_for(folder_id)
		.filter(connection => connection.from === id || connection.to === id)
		.map(connection => ({ ...connection }))
}

/**
 * `remove_untouched` for a file manager without its own (browser, demo:
 * their remove is permanent anyway): reads, then removes
 */
async function remove_untouched_by_reads(
	fm: FileManager,
	id: string,
	parent: string,
	expect: UntouchedExpect,
): Promise<'removed' | 'changed' | 'gone'> {
	const siblings = await fm.FolderChildren(parent).catch(() => null)
	const me = siblings?.find(child => child.id === id)
	if (!me) return 'gone'
	if (me.type === 'folder') {
		const names = (await fm.FolderChildren(id)).map(child => child.name).sort()
		const wanted = [...(expect.children ?? [])].sort()
		if (names.length !== wanted.length || names.some((name, i) => name !== wanted[i])) return 'changed'
	} else if (expect.text !== undefined) {
		if ((await fm.read_text_file(id)) !== expect.text) return 'changed'
	} else if (expect.size !== undefined && (await fm.entry_size(id)) !== expect.size) {
		return 'changed'
	}
	await fm.remove(id)
	return 'removed'
}

/** "добавление «photo.jpg»" for one file, "добавление: 3 элемента" for several */
function import_label(names: string[]): string {
	if (names.length !== 1) return t('undo.import_many', { count: count_items(names.length) })
	const parts = names[0]!.split(/[\\/]/)
	return t('undo.import_one', { name: parts[parts.length - 1] ?? names[0]! })
}

/** The step of a text file the person made: undo removes it while it still holds `content` */
function created_text(
	id: string,
	content: string,
	format: 'note' | 'svg' | 'plain',
	xattrs: { name: string; value: string }[],
): CreateStep {
	return {
		kind: 'entry_create',
		id,
		entry_type: 'file',
		expect: { text: content },
		xattrs: Object.fromEntries(xattrs.map(xattr => [xattr.name, xattr.value])),
		recipe: { via: 'text', content, format },
	}
}

async function persist_workspace_xattr(
	store: PersistXattrStore,
	fm: Pick<FileManager, 'set_xattr'>,
	folder_data: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string,
	record?: AttrRecord,
): Promise<boolean> {
	const owner_id = folder_data.id
	const saved = await persist_xattr(
		fm,
		folder_data,
		id,
		name,
		value,
		store.preview_folders,
		(error) => report_error(store, error),
		xattr_hooks(store, owner_id),
	)
	if (saved) note_attr_write(store, id, name, record?.before ?? null, value, false, record?.tx)
	return saved
}

type LookName = 'view' | 'cover' | 'icon' | 'background' | ImageTextField | 'text' | 'text_area'

/**
 * A look attribute: on screen at once (the folder, the listings that hold it,
 * the Cloud page's tile for a root), written in the background. A failed
 * write shows what the backend has again, the same way
 */
async function persist_look_xattr(
	store: PersistXattrStore & { type: string; uid: string },
	fm: Pick<FileManager, 'set_xattr' | 'remove_xattr' | 'get_xattr'>,
	owner: FolderWithChildrenXattrs,
	id: string,
	name: LookName,
	/** null clears the attribute */
	value: string | null,
	after?: Promise<boolean>,
	tx?: HistoryTx,
): Promise<boolean> {
	const holder = owner.id === id ? owner : owner.children?.find(child => child.id === id)
	const previous = holder?.xattrs.find(xattr => xattr.name === name)?.value ?? null
	const hooks = xattr_hooks(store, owner.id)
	const saved = await persist_xattr_now(fm, owner.id, id, name, value, {
		scope: store.uid,
		previous,
		after,
		show(shown) {
			show_xattr_locally(owner, id, name, shown, store.preview_folders, hooks)
			const listed = shown ?? 'none'
			if (name === 'cover' || name === 'icon') mirror_to_listings(store, id, name, listed)
			if ((name === 'view' || name === 'cover' || name === 'icon') && store.type === 'cloud' && id === '/') note_cloud_root_look(store.uid, name, listed)
		},
		reread: () => fm.get_xattr(id, name),
		on_error: error => report_error(store, error),
	})
	if (saved) note_attr_write(store, id, name, previous, value, true, tx)
	return saved
}

/**
 * A folder's own attribute (its cover, its icon) written on the folder also
 * shows in the listings that hold it as a child: a board or a canvas draws its
 * cards from the open folder's list, and would keep the old one until a refresh
 */
function mirror_to_listings(store: PersistXattrStore, folder_id: string, name: string, value: string) {
	for (const [owner_id, owner] of Object.entries(store.folders)) {
		if (owner_id === folder_id || !owner.children?.some(child => child.id === folder_id)) continue
		upsert_folder_xattr(owner, folder_id, name, value)
		notify_entry_xattr_changed(owner, folder_id)
		store.folders[owner_id] = { ...owner }
	}
}

let tab_seq = 0
const next_tab_id = () => `tab-${++tab_seq}`

export type WorkspaceStoreOptions = {
	/** Root folder id; defaults to `ws.id` (cloud workspaces open at "/"). */
	root_folder_id?: string
	/** False for read-only access (cloud viewer role, public link view). */
	can_write?: boolean
	/**
	 * False for a public-link visitor without membership: the board is read
	 * once and no realtime subscription is opened (so no realtime connection).
	 */
	live?: boolean
	/**
	 * This store's root is an unbounded local drive root (`~` or a volume).
	 * Drive turns it on: every watch is non-recursive (opened folder, root,
	 * expanded branches). Off, one recursive watch follows the opened folder.
	 */
	shallow_root?: boolean
	/** The root's read, already started (alongside the access check) */
	initial_root?: Promise<FolderWithChildrenXattrs>
	/** Folder reads started before the store existed; the first open of each takes its own once */
	prefetched?: Map<string, Promise<FolderWithChildrenXattrs>>
	/**
	 * What this device kept of a folder (cloud): an open shows it when it
	 * answers before the cloud does, and the cloud's answer follows it
	 */
	recall_folder?: (folder_id: string) => Promise<FolderWithChildrenXattrs | null>
}

export async function createWorkspaceStore(
	ws: WorkspacesListItem,
	fm: FileManager,
	{ root_folder_id = ws.id, can_write = true, live = true, shallow_root = false, initial_root, prefetched, recall_folder }: WorkspaceStoreOptions = {},
): Promise<WorkspaceStore | null> {
	const opened_folder: FolderWithChildrenXattrs = await active_step('root_read', () => initial_root ?? fm.folder_with_children_xattrs(root_folder_id))
	// A look still being saved in another store of this workspace (the cloud
	// copy and its publication) shows here too from the first read
	if (ws.type === 'cloud') apply_pending_entry_xattrs(opened_folder, ws.id, true)
	/** A read started before the store existed, taken once by the first open of that folder */
	const take_prefetched = (folder_id: string) => {
		const read = prefetched?.get(folder_id)
		prefetched?.clear()
		return read
	}
	/**
	 * A cloud folder already seen shows at once — from memory, or from this
	 * device — and is read again behind it. Every open still goes to the
	 * network; it only no longer waits for it. Local drives wait as before
	 */
	const shows_kept = ws.type === 'cloud'
	/**
	 * Cloud: the id a new entry will have (ids are paths), so it shows before
	 * the cloud answers. Elsewhere creating waits as before
	 */
	const optimistic_child = (folder_id: string, name: string) =>
		ws.type === 'cloud' ? (folder_id === '/' ? `/${name}` : `${folder_id}/${name}`) : undefined
	/** Set by the Explorer: a folder opened from a view goes through its navigation (its placeholder, history, header) */
	let open_folder_hook: ((folder_id: string) => unknown) | null = null
	let open_file_hook: ((file_id: string) => boolean) | null = null

	// Session content caches live per store instance (paths repeat across
	// workspaces — forks share the tree — so module-level caches would leak
	// content between windows). Dispose revokes media object URLs; the text
	// caches hold plain strings and are dropped with the store. markRaw:
	// their methods close over raw Maps; a reactive proxy would be wasted.
	const content_caches = markRaw(createEntryContentCaches())
	const media_cache = markRaw(createMediaSrcCache())

	let tree: WorkspaceTree
	let unwatch: Unwatch | null = null
	// A watch that resolves after a newer start_watching (quick navigation)
	// or after dispose is released at once instead of leaking its channel
	let watch_generation = 0
	// Bumped by every folder open and by cancel_open: an open applies its
	// folder only while it is the latest
	let open_generation = 0
	let disposed = false
	/**
	 * The store's first watch can take a second or two (the cloud channel's
	 * join), and the folder shows without waiting for it. Until it is live a
	 * change elsewhere goes unseen, so the folders read before then are read
	 * once more when it is. Only the cloud: a local or browser watch is
	 * instant, and those stores (and one without live updates) wait as before
	 */
	let watch_live = !live || shallow_root || ws.type !== 'cloud'

	/** Stable identity for `preview_folders` while folder keys / opened id are unchanged. */
	let preview_folders_cache: {
		opened_id: string
		folder_keys: string
		value: Record<string, FolderWithChildrenXattrs>
	} | null = null

	const stop_watching = () => {
		unwatch?.()
		unwatch = null
		for (const entry of drive_watches.values()) entry.unwatch()
		drive_watches.clear()
		drive_generation.clear()
	}

	/** True when every ancestor of `folder_id` up to `root` is expanded. */
	const expanded_branch_is_open = (
		folder_id: string,
		expanded: Set<string>,
		root: string,
	): boolean => {
		let current = parent_folder_id_from_node_id(folder_id, root)
		while (current !== root) {
			if (!expanded.has(current)) return false
			current = parent_folder_id_from_node_id(current, root)
		}
		return true
	}

	type DriveWatch = { unwatch: Unwatch; recursive: boolean }
	const drive_watches = new Map<string, DriveWatch>()
	const drive_generation = new Map<string, number>()
	let drive_clock = 0
	let shallow_reconcile_tail: Promise<void> = Promise.resolve()

	const drop_drive_watch = (folder_id: string) => {
		drive_generation.set(folder_id, ++drive_clock)
		const current = drive_watches.get(folder_id)
		if (!current) return
		current.unwatch()
		drive_watches.delete(folder_id)
	}

	const handle_watch_event = (
		store: WorkspaceStore,
		folder_id: string,
		event: WatchEvent,
	) => {
		void (async () => {
			if (event.kind === 'resync') {
				await resync_cached_folders(store, folder_id)
				return
			}
			if (batch_fs_update_active()) return

			// External content edits (e.g. Inkscape save) — drop cached
			// file content so subscribers re-read from disk.
			if (event.kind !== 'remove') {
				for (const id of event.ids) {
					content_caches.shapes.invalidate(id)
					content_caches.notes.invalidate(id)
				}
			}
			// New bytes under the same id (an image edited on disk, a
			// blob replaced in place in the cloud): images and videos
			// load again. Not on a layout-only change, and not on
			// 'other' — an access event from reading the file would
			// otherwise reload it forever
			if (
				(event.kind === 'modify' || event.kind === 'create' || event.kind === 'rename')
				&& event.content_changed !== false
			) {
				for (const id of event.ids) media_cache.invalidate(id)
			}

			const folder_ids = cached_folders_affected_by(
				store.folders,
				event.ids,
				store.id,
				event.kind,
			)
			for (const id of folder_ids) {
				await refresh_cached_folder(store, fm, id, event)
			}
		})()
	}

	const report_watch_error = (store: WorkspaceStore, error: unknown) => {
		const message = user_message_for_watch_error(error)
		if (message === null) {
			console.error(error)
			return
		}
		report_error(store, new Error(message))
	}

	const subscribe_drive_watch = async (
		store: WorkspaceStore,
		folder_id: string,
		recursive: boolean,
	) => {
		const generation = ++drive_clock
		drive_generation.set(folder_id, generation)
		let next: Unwatch
		try {
			next = await fm.watch(
				folder_id,
				(event) => handle_watch_event(store, folder_id, event),
				{ recursive },
			)
		} catch (error) {
			// The folder is gone (just deleted or moved; the next reconcile drops
			// it): nothing to watch and nothing to tell the user
			if (!is_missing_path_error(error)) report_watch_error(store, error)
			return
		}
		if (disposed || drive_generation.get(folder_id) !== generation) {
			next()
			return
		}
		drive_watches.set(folder_id, { unwatch: next, recursive })
	}

	const reconcile_shallow_watches_once = async (store: WorkspaceStore) => {
		if (!shallow_root || !live || disposed) return
		const opened = store.opened_folder_id
		// Every watch on a drive is non-recursive, the opened folder included:
		// a recursive watch on ~/Library or a node_modules tree hangs the app
		// (FSEvents flood, and the debounced watcher walks the whole subtree).
		// Deeper changes show up when a folder is opened or expanded: it is
		// read again then.
		const wanted = new Map<string, boolean>()
		wanted.set(opened, false)
		// The root listing stays visible. A deeper folder is watched only while
		// every ancestor up to the root is expanded; a collapsed parent hides
		// the branch, even if a nested id is still in the set.
		if (opened !== store.id) wanted.set(store.id, false)
		for (const id of store.expanded_folder_ids) {
			if (id === opened || id === store.id) continue
			if (!expanded_branch_is_open(id, store.expanded_folder_ids, store.id)) continue
			wanted.set(id, false)
		}
		for (const id of [...drive_watches.keys()]) {
			if (wanted.get(id) !== drive_watches.get(id)?.recursive) drop_drive_watch(id)
		}
		for (const [id, recursive] of wanted) {
			if (disposed) return
			if (drive_watches.get(id)?.recursive === recursive) continue
			await subscribe_drive_watch(store, id, recursive)
		}
	}

	const reconcile_shallow_watches = (store: WorkspaceStore): Promise<void> => {
		if (!shallow_root || !live) return Promise.resolve()
		const run = shallow_reconcile_tail.then(() => reconcile_shallow_watches_once(store))
		shallow_reconcile_tail = run.then(() => {}, () => {})
		return run
	}

	// Canvas ink bookkeeping: per-folder entity cache + live stroke watchers.
	// Kept in closures (not reactive): ids/promises/unwatch fns are internal.
	const strokes_loaded = new Set<string>()
	const strokes_pending = new Map<string, Promise<void>>()
	const strokes_unwatch = new Map<string, Unwatch>()

	const apply_strokes_event = (
		store: WorkspaceStore,
		folder_id: string,
		event: StrokesWatchEvent,
	) => {
		const current = store.strokes_by_folder[folder_id]
		if (!current) return
		const by_id = new Map<string, StrokeNode>(current.map(stroke => [stroke.id, stroke]))
		for (const stroke of event.upserted) by_id.set(stroke.id, folder_stroke_to_node(stroke))
		for (const id of event.deleted) by_id.delete(id)
		store.strokes_by_folder[folder_id] = [...by_id.values()].sort((a, b) => a.z - b.z)
	}

	// Ink re-listed after a gap in live updates (realtime rejoin): events
	// arriving meanwhile wait here per folder and are replayed over the list
	const strokes_resyncing = new Map<string, StrokesWatchEvent[]>()

	const resync_strokes = async (store: WorkspaceStore, folder_id: string) => {
		if (strokes_resyncing.has(folder_id)) return
		const buffered: StrokesWatchEvent[] = []
		strokes_resyncing.set(folder_id, buffered)
		const before = new Map<string, StrokeNode>(
			(store.strokes_by_folder[folder_id] ?? []).map(stroke => [stroke.id, stroke]),
		)
		try {
			const list = await fm.strokes.list_strokes(folder_id)
			if (!strokes_loaded.has(folder_id)) return
			// remote events are held in `buffered`, so a stroke that changed
			// since `before` was written here — newer than a list that may
			// predate it (the own echo never arrives): leave it alone
			const now = new Map<string, StrokeNode>(
				(store.strokes_by_folder[folder_id] ?? []).map(stroke => [stroke.id, stroke]),
			)
			const untouched = (id: string) => before.get(id) === now.get(id)
			const listed = new Set(list.map(stroke => stroke.id))
			apply_strokes_event(store, folder_id, {
				upserted: list.filter(stroke => untouched(stroke.id)),
				deleted: [...before.keys()].filter(id => !listed.has(id) && untouched(id)),
			})
			for (const event of buffered) apply_strokes_event(store, folder_id, event)
		} catch (error) {
			report_error(store, error)
		} finally {
			if (strokes_resyncing.get(folder_id) === buffered) strokes_resyncing.delete(folder_id)
		}
	}

	const stop_watching_strokes = () => {
		for (const unwatch_strokes of strokes_unwatch.values()) unwatch_strokes()
		strokes_unwatch.clear()
		strokes_loaded.clear()
		strokes_resyncing.clear()
	}

	// Canvas edge bookkeeping: same lazy per-folder cache + live watchers as ink.
	const connections_loaded = new Set<string>()
	const connections_pending = new Map<string, Promise<void>>()
	const connections_unwatch = new Map<string, Unwatch>()
	const connections_epoch = new Map<string, number>()

	function bump_connections_epoch(folder_id: string) {
		connections_epoch.set(folder_id, (connections_epoch.get(folder_id) ?? 0) + 1)
	}

	const apply_connections_event = (
		store: WorkspaceStore,
		folder_id: string,
		event: ConnectionsWatchEvent,
	) => {
		const current = store.connections_by_folder[folder_id]
		if (!current) return
		const by_id = new Map<string, Connection>(current.map(connection => [connection.id, connection]))
		for (const connection of event.upserted) {
			by_id.set(connection.id, folder_connection_to_connection(connection))
		}
		for (const id of event.deleted) by_id.delete(id)
		store.connections_by_folder[folder_id] = [...by_id.values()]
	}

	// Edges re-listed after a gap in live updates, same scheme as ink; a
	// rekey (folder moved) during the re-list abandons it via the epoch
	const connections_resyncing = new Map<string, ConnectionsWatchEvent[]>()

	const resync_connections = async (store: WorkspaceStore, folder_id: string) => {
		if (connections_resyncing.has(folder_id)) return
		const buffered: ConnectionsWatchEvent[] = []
		connections_resyncing.set(folder_id, buffered)
		const epoch = connections_epoch.get(folder_id) ?? 0
		const before = new Map<string, Connection>(
			(store.connections_by_folder[folder_id] ?? []).map(connection => [connection.id, connection]),
		)
		try {
			const list = await fm.connections.list_connections(folder_id)
			if (!connections_loaded.has(folder_id) || (connections_epoch.get(folder_id) ?? 0) !== epoch) return
			const now = new Map<string, Connection>(
				(store.connections_by_folder[folder_id] ?? []).map(connection => [connection.id, connection]),
			)
			const untouched = (id: string) => before.get(id) === now.get(id)
			const listed = new Set(list.map(connection => connection.id))
			apply_connections_event(store, folder_id, {
				upserted: list.filter(connection => untouched(connection.id)),
				deleted: [...before.keys()].filter(id => !listed.has(id) && untouched(id)),
			})
			for (const event of buffered) apply_connections_event(store, folder_id, event)
		} catch (error) {
			report_error(store, error)
		} finally {
			if (connections_resyncing.get(folder_id) === buffered) connections_resyncing.delete(folder_id)
		}
	}

	const stop_watching_connections = () => {
		for (const unwatch_connections of connections_unwatch.values()) unwatch_connections()
		connections_unwatch.clear()
		connections_loaded.clear()
		connections_pending.clear()
		connections_epoch.clear()
		connections_resyncing.clear()
	}

	// Live updates resumed after a gap (realtime rejoin): the events of the
	// gap are lost, so every cached folder of the watched subtree is re-read
	// and the text content of its entries re-fetched
	const resync_cached_folders = async (
		store: WorkspaceState & CanvasPersistStore & { content_caches: EntryContentCaches },
		folder_id: string,
	) => {
		const sep = path_separator(folder_id)
		const prefix = folder_id.endsWith(sep) ? folder_id : folder_id + sep
		const folder_ids = Object.keys(store.folders).filter(id => id === folder_id || id.startsWith(prefix))
		for (const id of folder_ids) {
			await refresh_cached_folder(store, fm, id, { kind: 'modify', ids: [id] })
			for (const child of store.folders[id]?.children ?? []) {
				content_caches.shapes.invalidate(child.id)
				content_caches.notes.invalidate(child.id)
				media_cache.invalidate(child.id)
			}
		}
	}

	/** Re-reads the root and the open folder once: what changed before the first watch was live */
	const became_live = (store: WorkspaceState & CanvasPersistStore & { content_caches: EntryContentCaches }) => {
		if (watch_live) return
		watch_live = true
		if (disposed) return
		for (const id of new Set([root_folder_id, store.opened_folder_id])) {
			if (store.folders[id]) void refresh_cached_folder(store, fm, id, { kind: 'modify', ids: [id] })
		}
	}

	const start_watching = async (
		store: WorkspaceState & CanvasPersistStore & { content_caches: EntryContentCaches },
		folder_id: string,
	) => {
		if (!live) return
		if (shallow_root) {
			await reconcile_shallow_watches(store as WorkspaceStore)
			return
		}
		const generation = ++watch_generation
		try {
			// Subscribe before releasing the previous watch: the cloud fm shares
			// one entries channel, which then stays joined across navigation
			// instead of a leave/join per opened folder
			const next = await fm.watch(
				folder_id,
				(event) => handle_watch_event(store as WorkspaceStore, folder_id, event),
				{ recursive: true },
			)
			became_live(store)
			if (disposed || generation !== watch_generation) {
				next()
				return
			}
			unwatch?.()
			unwatch = next
		} catch (error) {
			report_watch_error(store as WorkspaceStore, error)
		}
	}

	// Read-only access (cloud viewer role): every mutation below refuses up
	// front. UI also gates on `workspace.can_write`; RLS is the final
	// boundary — this guard only improves the error message
	const assert_can_write = () => {
		if (!can_write) {
			throw new Error('This workspace is read-only (viewer role)')
		}
	}

	try {
		tree = project_tree({
			id: root_folder_id,
			tree: [],
			folders: { [root_folder_id]: opened_folder },
			tree_loaded_folder_ids: new Set([root_folder_id]),
		})

		const initial_tab: WorkspaceTab = {
			id: next_tab_id(),
			folder_id: root_folder_id,
			back_stack: [],
		}

		// Reactive from the start: the watcher callback below and persist hooks
		// capture `workspace` in closures. If it only became reactive later
		// (when assigned into the root store), those closures would mutate the
		// raw object and Vue would never see cache replacements — e.g. a board
		// would stop updating after the first watch refresh.
		let stop_show_hidden_watch = () => {}
		let stop_shallow_watch = () => {}
		/**
		 * What goes with an entry once it is removed: its cached text, its place
		 * in the folders, the parent's edges to it, tabs inside it, and the ink
		 * and edge caches of folders inside it
		 */
		/** An entry back from the trash by its receipt, into the folder caches, with its edges */
		const restore_removed_here = async (store: WorkspaceStore, step: DeleteStep) => {
			const gone = { message: t('undo.restore_gone', { name: path_name(step.id) }) }
			if (!fm.restore_removed || !step.receipt.ticket) return gone
			let back: RestoreRemovedResult
			try {
				back = await fm.restore_removed(step.receipt)
			} catch (error) {
				report_error(store, error)
				return false as const
			}
			if (back === 'taken') return 'taken' as const
			if (back === 'gone') return gone
			const id = back.id
			let xattrs: Xattr[] = []
			try {
				xattrs = await fm.list_xattrs(id)
			} catch (error) {
				report_error(store, error)
			}
			apply_entry_created(store, parent_folder_id_from_node_id(id, store.id), {
				id,
				name: path_name(id),
				type: step.entry_type,
				xattrs,
			}, { notice: false })
			// Its edges come back with it, to where it came back
			if (step.edges.length > 0) {
				const edges = step.edges.map(edge => ({ ...edge, from: rebase_path(edge.from, step.id, id), to: rebase_path(edge.to, step.id, id) }))
				await store.ensure_connections(step.folder_id)
				await store.upsert_connections(step.folder_id, edges)
			}
			return { id }
		}

		const forget_removed = async (store: WorkspaceStore, id: string, owner_folder_id: string | undefined) => {
			const sep = path_separator(id)
			const is_inside_removed = (folder_id: string) =>
				folder_id === id || folder_id.startsWith(id + sep)
			invalidate_entry_content_caches(content_caches, id)
			apply_entry_removed(store, id)

			if (owner_folder_id) {
				await prune_folder_canvas_connections(store, owner_folder_id, [id])
			}

			const affected_tabs = store.tabs.filter(tab => is_inside_removed(tab.folder_id))
			if (affected_tabs.length > 0) {
				try {
					// Background tabs first: closing the active tab activates a
					// neighbor, which must not itself sit inside the removed subtree.
					for (const tab of affected_tabs) {
						if (store.tabs.length <= 1) break
						if (tab.id === store.active_tab_id) continue
						await store.close_tab(tab.id)
					}
					if (is_inside_removed(store.opened_folder_id)) {
						if (store.tabs.length > 1) {
							await store.close_tab(store.active_tab_id)
						} else {
							// Last remaining tab: fall back to the workspace root.
							await store.open_folder(store.id, { skipHistory: true })
						}
					}
					for (const folder_id of Object.keys(store.folders)) {
						if (is_inside_removed(folder_id)) {
							delete store.folders[folder_id]
						}
					}
				} catch (error) {
					report_error(store, error)
				}
			}

			// Ink cache/watches die with the folder regardless of open tabs.
			for (const folder_id of Object.keys(store.strokes_by_folder)) {
				if (is_inside_removed(folder_id)) {
					strokes_unwatch.get(folder_id)?.()
					strokes_unwatch.delete(folder_id)
					strokes_loaded.delete(folder_id)
					delete store.strokes_by_folder[folder_id]
				}
			}

			// Same for canvas edges.
			for (const folder_id of Object.keys(store.connections_by_folder)) {
				if (is_inside_removed(folder_id)) {
					connections_unwatch.get(folder_id)?.()
					connections_unwatch.delete(folder_id)
					connections_loaded.delete(folder_id)
					delete store.connections_by_folder[folder_id]
				}
			}
		}

		const workspace: WorkspaceStore = reactive({
			id: root_folder_id,
			uid: ws.id,
			type: ws.type,
			name: ws.name,
			// Drive sets it: only the Explorer's stores record undo history
			history_ref: null as HistoryStoreRef | null,
			can_write,
			pile_images: fm.pile_images,
			live,
			file_manager: fm,

		last_error: null as string | null,
		clear_error() {
			this.last_error = null
		},
		hidden_notice: null as string | null,
		clear_hidden_notice() {
			this.hidden_notice = null
		},

		import_progress: null as ImportProgress | null,
		is_disposed: false,

		dispose() {
			this.is_disposed = true
			disposed = true
			stop_shallow_watch()
			stop_watching()
			stop_watching_strokes()
			stop_watching_connections()
			stop_show_hidden_watch()
			media_cache.clear()
			// the entry clipboard is global and intentionally survives disposal:
			// entries cut here stay pasteable through the still-live file manager
		},

		content_caches,
		media_cache,

			tree,
			expanded_folder_ids: new Set<string>(),
			is_folder_expanded(folder_id: string) {
				return this.expanded_folder_ids.has(folder_id)
			},
			toggle_folder_expanded(folder_id: string) {
				if (this.expanded_folder_ids.has(folder_id)) {
					this.expanded_folder_ids.delete(folder_id)
				} else {
					this.expanded_folder_ids.add(folder_id)
				}
			},
			prepare_folder_for_drop(folder_id: string, should_apply?: () => boolean) {
				const folder = find_tree_node(this.tree, folder_id)
				if (!folder || folder.type !== 'folder') return

				if (!folder.children) {
					folder.children = []
				}

				this.expanded_folder_ids.add(folder_id)
				if (!folder.children_loaded) {
					void this.show_folder_children(folder_id, should_apply)
				}
			},

			async expand_folder_in_sidebar(folder_id: string, should_apply?: () => boolean) {
				if (folder_id === this.id) return

				for (const id of folder_ancestor_chain(folder_id, this.id)) {
					if (this.expanded_folder_ids.has(id)) continue

					const node = find_tree_node(this.tree, id)
					if (node?.type === 'folder' && !node.children_loaded) {
						await this.show_folder_children(id, should_apply)
					}
					this.expanded_folder_ids.add(id)
				}
			},

			loading_folder_ids: new Set<string>(),
			is_folder_loading(folder_id: string) {
				return this.loading_folder_ids.has(folder_id)
			},

			// set while open_folder awaits the fetch — the header shows a
			// spinner next to the folder title on slow (cloud) loads
			opening_folder_id: null as string | null,

			// the open folder shows what was kept (memory or this device) while
			// the cloud is read again; the header marks it until that answer
			refreshing_folder_id: null as string | null,

			tree_loaded_folder_ids: new Set<string>([root_folder_id]),

		// Normalized folder cache: single source of truth for folder data.
		// opened_folder / preview_folders are derived views kept for
		// compatibility with existing consumers.
		folders: { [root_folder_id]: opened_folder } as Record<string, FolderWithChildrenXattrs>,

		// Canvas ink cache, sorted by z. Filled lazily via ensure_strokes;
		// kept fresh by fm.strokes watchers and optimistic local writes.
		strokes_by_folder: {} as Record<string, StrokeNode[]>,

		// Canvas edge cache. Filled lazily via ensure_connections; kept fresh
		// by fm.connections watchers and optimistic local writes.
		connections_by_folder: {} as Record<string, Connection[]>,

		// Open folder tabs (browser model): each tab owns its folder and its
		// back history. opened_folder_id / folder_back_stack delegate to the
		// active tab, so existing navigation and mutation helpers keep working.
		tabs: [initial_tab] as WorkspaceTab[],
		active_tab_id: initial_tab.id as string,

		get active_tab(): WorkspaceTab {
			return this.tabs.find(tab => tab.id === this.active_tab_id) ?? this.tabs[0]!
		},

		get opened_folder_id(): string {
			return this.active_tab.folder_id
		},
		set opened_folder_id(folder_id: string) {
			this.active_tab.folder_id = folder_id
		},

		get folder_back_stack(): string[] {
			return this.active_tab.back_stack
		},
		set folder_back_stack(stack: string[]) {
			this.active_tab.back_stack = stack
		},

		get can_go_back() {
			return this.folder_back_stack.length > 0
		},

		async go_back() {
			const previous_id = this.folder_back_stack.pop()
			if (!previous_id) return
			await this.open_folder(previous_id, { fromBack: true })
		},

		async open_folder_in_new_tab(folder_id: string) {
			// The tab starts at the current folder so opened_folder keeps
			// reading a cached folder while the target one is fetched.
			const tab: WorkspaceTab = {
				id: next_tab_id(),
				folder_id: this.opened_folder_id,
				back_stack: [],
			}
			this.tabs.push(tab)
			this.active_tab_id = tab.id
			await this.navigate_open_folder(folder_id, { skipHistory: true })
		},

		async activate_tab(tab_id: string) {
			if (tab_id === this.active_tab_id) return
			const tab = this.tabs.find(t => t.id === tab_id)
			if (!tab) return
			this.active_tab_id = tab_id
			// Background tabs are not fs-watched: force a refetch so the
			// folder is fresh and the watcher reattaches to it.
			await this.navigate_open_folder(tab.folder_id, { skipHistory: true, force: true })
		},

		async close_tab(tab_id: string) {
			if (this.tabs.length <= 1) return
			const index = this.tabs.findIndex(t => t.id === tab_id)
			if (index === -1) return
			const was_active = this.active_tab_id === tab_id
			this.tabs.splice(index, 1)
			if (was_active) {
				const next = this.tabs[index] ?? this.tabs[index - 1]
				if (next) {
					this.active_tab_id = next.id
					await this.navigate_open_folder(next.folder_id, { skipHistory: true, force: true })
				}
			}
		},

			get opened_folder(): FolderWithChildrenXattrs {
				return this.folders[this.opened_folder_id]!
			},

			get preview_folders(): Record<string, FolderWithChildrenXattrs> {
				const folders = this.folders as Record<string, FolderWithChildrenXattrs>
				const folder_keys = Object.keys(folders).join('\0')
				if (
					preview_folders_cache
					&& preview_folders_cache.opened_id === this.opened_folder_id
					&& preview_folders_cache.folder_keys === folder_keys
				) {
					// Keep Record identity stable, but refresh entry references
					// when folders[id] is replaced (e.g. watch refresh).
					const previews = preview_folders_cache.value
					for (const id of Object.keys(folders)) {
						if (id !== this.opened_folder_id) {
							previews[id] = folders[id]!
						}
					}
					return previews
				}

				const previews: Record<string, FolderWithChildrenXattrs> = {}
				for (const id of Object.keys(folders)) {
					if (id !== this.opened_folder_id) {
						previews[id] = folders[id]!
					}
				}
				preview_folders_cache = {
					opened_id: this.opened_folder_id,
					folder_keys,
					value: previews,
				}
				return previews
			},

			resolve_folder_data(folder_id: string): FolderWithChildrenXattrs | null {
				return this.folders[folder_id] ?? null
			},

			async ensure_preview_folder(folder_id: string) {
				if (this.folders[folder_id]) {
					return
				}

				let folder_data: FolderWithChildrenXattrs
				const ticket = folder_read_ticket(this, folder_id)
				const read = fm.folder_with_children_xattrs(folder_id)
				const kept = shows_kept && recall_folder
					? await Promise.race([read.then(() => null, () => null), recall_folder(folder_id)])
					: null
				if (this.folders[folder_id]) return
				if (kept && ticket.is_latest()) {
					// a preview shows what this device kept; the cloud's answer follows it
					apply_pending_entry_xattrs(kept, this.uid, true)
					folder_data = kept
					this.folders[folder_id] = kept
					void refresh_cached_folder(this, fm, folder_id, reread_event(folder_id), { read, ticket })
				} else {
					try {
						folder_data = await read
					} catch (error) {
						report_error(this, error)
						return
					}
					if (ticket.is_latest()) {
						ticket.applied()
						if (shows_kept) apply_pending_entry_xattrs(folder_data, this.uid, true)
					} else if (this.folders[folder_id]) return
				}

		this.folders[folder_id] = folder_data
		void this.ensure_strokes(folder_id)
		void this.ensure_connections(folder_id)

		await Promise.all(
			collect_preview_folder_ids(folder_data.children ?? []).map(id =>
				this.ensure_preview_folder(id),
			),
		)
	},

			async prefetch_preview_folders(entries: FolderWithChildrenXattrs['children']) {
				await Promise.all(
					collect_preview_folder_ids(entries ?? []).map(id =>
						this.ensure_preview_folder(id),
					),
				)
			},

			get folder_container() {
				return to_folder_container(this.opened_folder, this.preview_folders)
			},
			is_opened_folder(folder_id: string) {
				return this.opened_folder.id === folder_id
			},
		async open_folder(
			folder_id: string,
			options?: { fromBack?: boolean; skipHistory?: boolean },
		) {
			return this.navigate_open_folder(folder_id, options)
		},

		cancel_open() {
			open_generation += 1
			this.opening_folder_id = null
		},

		async navigate_open_folder(
			folder_id: string,
			options?: { fromBack?: boolean; skipHistory?: boolean; force?: boolean },
		) {
			if (!options?.force && folder_id === this.opened_folder_id) return true

			// The slower of two opens must not put its folder back on screen
			const generation = ++open_generation
			const current = () => generation === open_generation && !disposed
			const left = this.opened_folder_id
			const started_live = watch_live

			this.exit_selection_mode()

		this.opening_folder_id = folder_id
		let folder_data: FolderWithChildrenXattrs
		/** Shown from what was kept: the cloud's answer still has to come in behind it */
		let reread: Promise<'gone' | void> | null = null
		try {
			const in_memory = shows_kept && !options?.force ? this.folders[folder_id] : undefined
			if (in_memory) {
				folder_data = in_memory
				reread = refresh_cached_folder(this, fm, folder_id, reread_event(folder_id))
			} else {
				const ticket = folder_read_ticket(this, folder_id)
				const read = take_prefetched(folder_id) ?? fm.folder_with_children_xattrs(folder_id)
				// the device answers in milliseconds; the cloud's read runs alongside, so a miss costs nothing
				const kept = shows_kept && recall_folder && !options?.force
					? await Promise.race([read.then(() => null, () => null), recall_folder(folder_id)])
					: null
				if (!current()) return false
				if (kept && ticket.is_latest()) {
					apply_pending_entry_xattrs(kept, this.uid, true)
					folder_data = kept
					this.folders[folder_id] = kept
					reread = refresh_cached_folder(this, fm, folder_id, reread_event(folder_id), { read, ticket })
				} else {
					folder_data = await active_step('read', () => read)
					if (!current()) return false
					// a refresh that started later already put a newer one in place
					if (ticket.is_latest()) {
						ticket.applied()
						if (shows_kept) apply_pending_entry_xattrs(folder_data, this.uid, true)
					} else if (this.folders[folder_id]) {
						folder_data = this.folders[folder_id]!
					}
				}
			}
			if (!options?.fromBack && !options?.skipHistory) this.folder_back_stack.push(left)
			this.folders[folder_id] = folder_data
			this.opened_folder_id = folder_id
			if (reread) {
				this.refreshing_folder_id = folder_id
				void reread
					.then((result) => {
						// Deleted elsewhere while this device still had it: say so and step out to its parent
						if (result !== 'gone' || this.opened_folder_id !== folder_id || folder_id === this.id) return
						report_error(this, new Error(t('folder.gone')))
						void this.open_folder(parent_folder_id_from_node_id(folder_id, this.id))
					})
					.catch((error: unknown) => report_error(this, error))
					.finally(() => {
						if (this.refreshing_folder_id === folder_id) this.refreshing_folder_id = null
					})
			} else if (this.refreshing_folder_id !== null) {
				this.refreshing_folder_id = null
			}
		} finally {
			if (this.opening_folder_id === folder_id && current()) this.opening_folder_id = null
		}
		// shown from what was kept: the previews fill in behind it, the open does not wait
		if (reread) void this.prefetch_preview_folders(folder_data.children)
		else await active_step('prefetch', () => this.prefetch_preview_folders(folder_data.children))

		if (folder_id === this.id || find_tree_node(this.tree, folder_id)) {
			this.tree_loaded_folder_ids.add(folder_id)
			sync_tree_from_folders(this)
		}

	// The first watch of a store is the slow one: the folder does not wait for it
	if (watch_live) await active_step('watch', () => start_watching(this, folder_id))
	else void start_watching(this, folder_id)
	// It went live while this folder was read: read it once more
	if (!started_live && watch_live && current()) {
		void refresh_cached_folder(this, fm, folder_id, { kind: 'modify', ids: [folder_id] })
	}
	void this.ensure_strokes(folder_id)
	void this.ensure_connections(folder_id)
	await active_step('expand', () => this.expand_folder_in_sidebar(folder_id))
	// Expansion changes the set after the opened-folder watch. The shallow
	// watcher queues that pass; wait until it has caught up.
	if (shallow_root) await shallow_reconcile_tail
	return current()
},

			async change_folder_view(folder_id: string, new_view: FolderView) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if (container.view === new_view) {
					return
				}
				this.exit_selection_mode()
				await persist_look_xattr(this, fm, folder_data, folder_id, 'view', stored_folder_view(new_view))
			},

			async change_folder_cover(folder_id: string, cover: string, options?: LookWriteOptions & HistoryOptions) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return
				const previous = folder_data.xattrs.find(xattr => xattr.name === 'cover')?.value ?? 'none'
				if (previous === cover) return
				// A picture, new or replaced, cannot be undone yet: the old one is swept
				const picture = is_picture_value(cover) || is_picture_value(previous)
				if (picture) block_history(this, t('undo.op.cover_picture'))
				await persist_look_xattr(this, fm, folder_data, folder_id, 'cover', cover, options?.after, picture ? undefined : options?.tx)
			},

			async change_folder_icon(folder_id: string, icon: string, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return
				if ((folder_data.xattrs.find(xattr => xattr.name === 'icon')?.value ?? 'none') === icon) return
				await persist_look_xattr(this, fm, folder_data, folder_id, 'icon', icon, undefined, options?.tx)
			},

			async change_selected_slide_index(folder_id: string, index: number) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if (container.selected_slide_index === index) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'selected_slide_index',
					String(index),
				)
			},

			async change_snap_to_grid(folder_id: string, snap_to_grid: boolean) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if (container.snap_to_grid === snap_to_grid) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'snap_to_grid',
					String(snap_to_grid),
				)
				if (snap_to_grid && container.grid_size === undefined) {
					await persist_workspace_xattr(this, fm, folder_data, folder_id, 'grid_size', '20')
				}
			},

			async change_grid_size(folder_id: string, grid_size: number) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if (container.grid_size === grid_size) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'grid_size',
					String(grid_size),
				)
			},

			async change_show_grid_dots(folder_id: string, show_grid_dots: boolean) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				const current = container.show_grid_dots ?? true
				if (current === show_grid_dots) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'show_grid_dots',
					String(show_grid_dots),
				)
			},

			async change_show_axes(folder_id: string, show_axes: boolean) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				const current = container.show_axes ?? false
				if (current === show_axes) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'show_axes',
					String(show_axes),
				)
			},

			async change_dashboard_cell(id: string, cell: DashboardCell, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				const current = entity?.dashboard
				if (
					current?.x === cell.x
					&& current?.y === cell.y
					&& current?.w === cell.w
					&& current?.h === cell.h
				) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					id,
					'dashboard',
					JSON.stringify(cell),
					{ tx: options?.tx, before: raw_xattr(folder_data, id, 'dashboard') },
				)
			},

			async change_dashboard_compact(folder_id: string, compact: boolean) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if ((container.dashboard_compact === true) === compact) return
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'dashboard_compact',
					String(compact),
				)
			},

			async change_option_3d(folder_id: string, option: Option3D, on: boolean) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return
				const container = to_folder_container(folder_data, this.preview_folders)
				if ((container[option] === true) === on) return
				await persist_workspace_xattr(this, fm, folder_data, folder_id, option, String(on))
			},

			async change_floor_3d(folder_id: string, floor: Floor3D) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if (floor_3d_from_stored(container.floor_3d) === floor) return
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'floor_3d',
					floor,
				)
			},

			async change_masonry_column_width(folder_id: string, width: number) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return
				if (width !== 180 && width !== 240 && width !== 320) return

				const container = to_folder_container(folder_data, this.preview_folders)
				const current = container.masonry_column_width ?? 240
				if (current === width) return
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'masonry_column_width',
					String(width),
				)
			},

			async change_masonry_columns(folder_id: string, columns: number) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return
				// 0 is Auto: as many columns as fit. Absent reads the same way.
				if (!Number.isInteger(columns) || columns < 0) return

				const container = to_folder_container(folder_data, this.preview_folders)
				const current = container.masonry_columns ?? 0
				if (current === columns) return
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					folder_id,
					'masonry_columns',
					String(columns),
				)
			},

		connections_folder_ids(): string[] {
			return Object.keys(this.connections_by_folder)
		},

		connections_for(folder_id: string): Connection[] {
			return this.connections_by_folder[folder_id] ?? []
		},

		rekey_connections(old_id: string, new_id: string) {
			if (old_id === new_id) return
			const sep = path_separator(old_id)
			const old_prefix = old_id + sep
			for (const key of Object.keys(this.connections_by_folder)) {
				if (key === old_id || key.startsWith(old_prefix)) {
					const new_key = new_id + key.slice(old_id.length)
					this.connections_by_folder[new_key] = this.connections_by_folder[key]!
					delete this.connections_by_folder[key]
					// The sidecar watch is bound to the old path; after a
					// move it fires "everything deleted" and would empty the
					// rekeyed cache. Drop it and force the next ensure to
					// re-read the (rebased) sidecar at the new path.
					bump_connections_epoch(key)
					bump_connections_epoch(new_key)
					connections_loaded.delete(key)
					connections_loaded.delete(new_key)
					connections_pending.delete(key)
					const unwatch_connections = connections_unwatch.get(key)
					if (unwatch_connections) {
						connections_unwatch.delete(key)
						unwatch_connections()
					}
				}
			}
		},

		async ensure_connections(folder_id: string) {
			if (connections_loaded.has(folder_id)) return
			const pending = connections_pending.get(folder_id)
			if (pending) return pending

			const epoch = connections_epoch.get(folder_id) ?? 0
			const load = (async () => {
				// Subscribe before listing: events that land between the list
				// and the watch would otherwise be lost — buffer and replay.
				// A store without live updates only lists.
				let buffered: ConnectionsWatchEvent[] | null = []
				let unwatch_connections: Unwatch | undefined
				try {
					if (live) {
						unwatch_connections = await fm.connections.watch_connections(folder_id, (event) => {
							if (buffered) {
								buffered.push(event)
							} else if (event.resync) {
								void resync_connections(this, folder_id)
							} else {
								const resyncing = connections_resyncing.get(folder_id)
								if (resyncing) resyncing.push(event)
								else apply_connections_event(this, folder_id, event)
							}
						})
						if (disposed || (connections_epoch.get(folder_id) ?? 0) !== epoch) {
							unwatch_connections()
							return
						}
						connections_unwatch.set(folder_id, unwatch_connections)
					}
					const list = await fm.connections.list_connections(folder_id)
					if ((connections_epoch.get(folder_id) ?? 0) !== epoch) {
						unwatch_connections?.()
						connections_unwatch.delete(folder_id)
						return
					}
					this.connections_by_folder[folder_id] = list.map(folder_connection_to_connection)
					connections_loaded.add(folder_id)
					const replay = buffered
					buffered = null
					for (const event of replay) apply_connections_event(this, folder_id, event)
				} catch (error) {
					// A folder deleted meanwhile has no edges to load
					if (!is_missing_path_error(error)) report_error(this, error)
				} finally {
					connections_pending.delete(folder_id)
				}
			})()
			connections_pending.set(folder_id, load)
			return load
		},

		async upsert_connections(folder_id: string, connections: Connection[], options?: HistoryOptions) {
			assert_can_write()
			if (connections.length === 0) return true

			const by_id = new Map<string, Connection>(
				(this.connections_by_folder[folder_id] ?? []).map(connection => [connection.id, connection]),
			)
			const touched = new Set(connections.map(connection => connection.id))
			const before = [...by_id.values()].filter(connection => touched.has(connection.id))
			for (const connection of connections) by_id.set(connection.id, connection)
			this.connections_by_folder[folder_id] = [...by_id.values()]

			try {
				await fm.connections.upsert_connections(folder_id, connections.map(connection_to_folder_connection))
			} catch (error) {
				report_error(this, error)
				// Simple rollback: reload the folder's edges from storage.
				try {
					const list = await fm.connections.list_connections(folder_id)
					this.connections_by_folder[folder_id] = list.map(folder_connection_to_connection)
				} catch (reload_error) {
					report_error(this, reload_error)
				}
				return false
			}
			options?.tx?.record({ kind: 'edges', folder_id, ids: [...touched], before, after: [...connections] })
			return true
		},

		async delete_connections(folder_id: string, connection_ids: string[], options?: HistoryOptions) {
			assert_can_write()
			if (connection_ids.length === 0) return true

			const doomed = new Set(connection_ids)
			const current = this.connections_by_folder[folder_id]
			const before = (current ?? []).filter(connection => doomed.has(connection.id))
			if (current) {
				this.connections_by_folder[folder_id] = current.filter(connection => !doomed.has(connection.id))
			}

			try {
				await fm.connections.delete_connections(folder_id, connection_ids)
			} catch (error) {
				report_error(this, error)
				try {
					const list = await fm.connections.list_connections(folder_id)
					this.connections_by_folder[folder_id] = list.map(folder_connection_to_connection)
				} catch (reload_error) {
					report_error(this, reload_error)
				}
				return false
			}
			options?.tx?.record({ kind: 'edges', folder_id, ids: [...doomed], before, after: [] })
			return true
		},

			strokes_for(folder_id: string): StrokeNode[] {
				return this.strokes_by_folder[folder_id] ?? []
			},

			async ensure_strokes(folder_id: string) {
				if (strokes_loaded.has(folder_id)) return
				const pending = strokes_pending.get(folder_id)
				if (pending) return pending

				const load = (async () => {
					// Subscribe before listing: events that land between the list
					// and the watch would otherwise be lost — buffer and replay.
					// A store without live updates only lists.
					let buffered: StrokesWatchEvent[] | null = []
					try {
						if (live) {
							const unwatch_strokes = await fm.strokes.watch_strokes(folder_id, (event) => {
								if (buffered) {
									buffered.push(event)
								} else if (event.resync) {
									void resync_strokes(this, folder_id)
								} else {
									const resyncing = strokes_resyncing.get(folder_id)
									if (resyncing) resyncing.push(event)
									else apply_strokes_event(this, folder_id, event)
								}
							})
							if (disposed) {
								unwatch_strokes()
								return
							}
							strokes_unwatch.set(folder_id, unwatch_strokes)
						}
						const list = await fm.strokes.list_strokes(folder_id)
						this.strokes_by_folder[folder_id] = list.map(folder_stroke_to_node)
						strokes_loaded.add(folder_id)
						const replay = buffered
						buffered = null
						for (const event of replay) apply_strokes_event(this, folder_id, event)
					} catch (error) {
						// A folder deleted meanwhile has no ink to load: not the user's problem
						if (!is_missing_path_error(error)) report_error(this, error)
					} finally {
						strokes_pending.delete(folder_id)
					}
				})()
				strokes_pending.set(folder_id, load)
				return load
			},

			async upsert_strokes(folder_id: string, strokes: StrokeNode[], options?: HistoryOptions) {
				assert_can_write()
				if (strokes.length === 0) return true

			const by_id = new Map<string, StrokeNode>(
				(this.strokes_by_folder[folder_id] ?? []).map(stroke => [stroke.id, stroke]),
			)
				const touched = new Set(strokes.map(stroke => stroke.id))
				const before = [...by_id.values()].filter(stroke => touched.has(stroke.id))
				for (const stroke of strokes) by_id.set(stroke.id, stroke)
				this.strokes_by_folder[folder_id] = [...by_id.values()].sort((a, b) => a.z - b.z)

				try {
					await fm.strokes.upsert_strokes(folder_id, strokes.map(node_to_folder_stroke))
				} catch (error) {
					report_error(this, error)
					// Simple rollback: reload the folder's ink from storage.
					try {
						const list = await fm.strokes.list_strokes(folder_id)
						this.strokes_by_folder[folder_id] = list.map(folder_stroke_to_node)
					} catch (reload_error) {
						report_error(this, reload_error)
					}
					return false
				}
				options?.tx?.record({ kind: 'strokes', folder_id, ids: [...touched], before, after: [...strokes] })
				return true
			},

			async delete_strokes(folder_id: string, stroke_ids: string[], options?: HistoryOptions) {
				assert_can_write()
				if (stroke_ids.length === 0) return true

				const doomed = new Set(stroke_ids)
				const current = this.strokes_by_folder[folder_id]
				const before = (current ?? []).filter(stroke => doomed.has(stroke.id))
				if (current) {
					this.strokes_by_folder[folder_id] = current.filter(stroke => !doomed.has(stroke.id))
				}

				try {
					await fm.strokes.delete_strokes(folder_id, stroke_ids)
				} catch (error) {
					report_error(this, error)
					try {
						const list = await fm.strokes.list_strokes(folder_id)
						this.strokes_by_folder[folder_id] = list.map(folder_stroke_to_node)
					} catch (reload_error) {
						report_error(this, reload_error)
					}
					return false
				}
				options?.tx?.record({ kind: 'strokes', folder_id, ids: [...doomed], before, after: [] })
				return true
			},

			async change_background(id: string, new_background: ImageBase64 | Color, options?: LookWriteOptions & HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				if (entity?.background === new_background) {
					return
				}
				// A picture, new or replaced, cannot be undone yet: the old one is swept
				const picture = is_picture_value(new_background) || is_picture_value(raw_xattr(folder_data, id, 'background'))
				if (picture) block_history(this, t('undo.op.background_picture'))
				await persist_look_xattr(this, fm, folder_data, id, 'background', new_background, options?.after, picture ? undefined : options?.tx)
			},

			async set_image_text(id: string, field: ImageTextField, value: string, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				const current = entity?.type === 'file' ? entity[field] : undefined
				const next = image_text_from_stored(value)
				if (current === next) return

				// On screen at once, written in the background, like a folder's look.
				await persist_look_xattr(this, fm, folder_data, id, field, next ?? null, undefined, options?.tx)
			},

			/** A shape's text (markdown): on screen at once, written in the background; empty removes it. */
			async set_shape_text(id: string, markdown: string, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return
				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				const current = entity?.type === 'file' ? entity.text ?? null : null
				const next = markdown.trim() ? markdown : null
				if (current === next) return
				// As a JSON string: an xattr reads back through JSON.parse and Number, and
				// a text like `[1]`, `"quoted"` or `2024` would come back as something else
				await persist_look_xattr(this, fm, folder_data, id, 'text', next === null ? null : JSON.stringify(next), undefined, options?.tx)
			},

			/** Where a shape's text sits: null is inside the shape (the default), "frame" the whole frame. */
			async set_shape_text_area(id: string, area: 'frame' | null, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return
				await persist_look_xattr(this, fm, folder_data, id, 'text_area', area, undefined, options?.tx)
			},

			async change_shape_fill(id: string, color: Color, options?: HistoryOptions) {
				assert_can_write()
				try {
					const raw = await fm.read_text_file(id)
					const updated = apply_shape_color(raw, color)
					if (updated === raw) return

				await fm.save_text_file(id, updated)
				const prepared = prepare_svg_for_preview(updated)
				content_caches.shapes.set(id, prepared)
				options?.tx?.record({ kind: 'content', id, format: 'svg', before: raw, after: updated })
				} catch (error) {
					report_error(this, error)
				}
			},

			async change_line_geometry(
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
				options?: HistoryOptions,
			) {
				assert_can_write()
				try {
					const raw = await fm.read_text_file(id)
					if (!is_line_shape(raw)) return

					const container = to_folder_container(this.opened_folder, this.preview_folders)
					const entity = find_widget(container, id)
					const fallbackSize = entity && 'size' in entity && entity.size
						? entity.size
						: geometry.size

					const meta = parse_line_meta(raw, fallbackSize)
					if (!meta) return

					const nextSvg = build_line_svg({
						...meta,
						width: geometry.size.width,
						height: geometry.size.height,
						flipX: geometry.flipX,
						flipY: geometry.flipY,
						axis: geometry.axis ?? meta.axis,
						startPlug: geometry.startPlug ?? meta.startPlug,
						endPlug: geometry.endPlug ?? meta.endPlug,
					})

				await fm.save_text_file(id, nextSvg)
				content_caches.shapes.set(id, prepare_svg_for_preview(nextSvg))
				options?.tx?.record({ kind: 'content', id, format: 'svg', before: raw, after: nextSvg })
				// The box moves with the drawing: one action, so undo puts back all three
				await this.change_position(id, geometry.position, options)
				await this.change_size(id, geometry.size, options)
				} catch (error) {
					report_error(this, error)
				}
			},

			async change_line_plugs(
				id: string,
				plugs: {
					startPlug: LinePlug
					endPlug: LinePlug
				},
				options?: HistoryOptions,
			) {
				assert_can_write()
				try {
					const raw = await fm.read_text_file(id)
					if (!is_line_shape(raw)) return

					const container = to_folder_container(this.opened_folder, this.preview_folders)
					const entity = find_widget(container, id)
					const fallbackSize = entity && 'size' in entity && entity.size
						? entity.size
						: undefined

					const meta = parse_line_meta(raw, fallbackSize)
					if (!meta) return

					const nextSvg = build_line_svg({
						...meta,
						startPlug: plugs.startPlug,
						endPlug: plugs.endPlug,
					})

				await fm.save_text_file(id, nextSvg)
				content_caches.shapes.set(id, prepare_svg_for_preview(nextSvg))
				options?.tx?.record({ kind: 'content', id, format: 'svg', before: raw, after: nextSvg })
			} catch (error) {
				report_error(this, error)
			}
		},

		async change_cover(id: string, new_cover: Color, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				if (entity && 'cover' in entity && entity.cover === new_cover) {
					return
				}
				await persist_workspace_xattr(this, fm, folder_data, id, 'cover', new_cover, {
					tx: options?.tx,
					before: raw_xattr(folder_data, id, 'cover'),
				})
			},

			async change_position(id: string, new_position: Position, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const owner_id = folder_data.id
				const live = this.folders[owner_id] ?? folder_data
				const entry = live.id === id
					? live
					: live.children?.find(c => c.id === id)
				const current = entry
					? (xattrs_map(entry.xattrs).position as Position | undefined)
					: undefined
				if (
					current?.x === new_position.x
					&& current?.y === new_position.y
				) {
					return
				}
				// read before the optimistic update below shows the new place
				const before = raw_xattr(live, id, 'position')

				const value = JSON.stringify(new_position)
				// Optimistic memory update so board/preview re-render before disk I/O.
				upsert_folder_xattr(live, id, 'position', value)
				notify_entry_xattr_changed(live, id)
				this.folders[owner_id] = {
					...live,
					xattrs: [...live.xattrs],
					children: live.children?.map(child => ({
						...child,
						xattrs: [...child.xattrs],
					})),
				}

				await persist_workspace_xattr(
					this,
					fm,
					this.folders[owner_id]!,
					id,
					'position',
					value,
					{ tx: options?.tx, before },
				)
			},

			async change_height(id: string, height: number, options?: HistoryOptions) {
				assert_can_write()
				if (!Number.isFinite(height)) return
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const owner_id = folder_data.id
				const live = this.folders[owner_id] ?? folder_data
				const value = String(Math.max(0, Math.round(height)))
				// read before the optimistic update below shows the new height
				const before = raw_xattr(live, id, 'z')
				if (before === value) return

				// As change_position: on screen at once, written after
				upsert_folder_xattr(live, id, 'z', value)
				notify_entry_xattr_changed(live, id)
				this.folders[owner_id] = {
					...live,
					xattrs: [...live.xattrs],
					children: live.children?.map(child => ({
						...child,
						xattrs: [...child.xattrs],
					})),
				}

				await persist_workspace_xattr(
					this,
					fm,
					this.folders[owner_id]!,
					id,
					'z',
					value,
					{ tx: options?.tx, before },
				)
			},

			async change_size(id: string, new_size: Size, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				if (
					entity?.size?.width === new_size.width
					&& entity?.size?.height === new_size.height
				) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					id,
					'size',
					JSON.stringify(new_size),
					{ tx: options?.tx, before: raw_xattr(folder_data, id, 'size') },
				)
			},

			async change_model_camera(id: string, state: ModelCameraState) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				const current = entity && 'model_camera' in entity ? entity.model_camera : undefined
				if (
					current?.orbit === state.orbit
					&& current?.target === state.target
					&& current?.fieldOfView === state.fieldOfView
				) {
					return
				}
				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					id,
					'model_camera',
					JSON.stringify(state),
				)
			},

			async change_is_preview(id: string, is_preview: boolean, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = this.folder_container
				const entity = find_widget(container, id)
				if (entity?.is_preview === is_preview) {
					return
				}

				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					id,
					'is_preview',
					String(is_preview),
					{ tx: options?.tx, before: raw_xattr(folder_data, id, 'is_preview') },
				)

				if (is_preview) {
					const entry = folder_data.children?.find(c => c.id === id)
					if (entry?.type === 'folder') {
						await this.ensure_preview_folder(id)
					}

					const parent_container = this.folder_container
					const index = parent_container.children.findIndex(c => c.id === id)
					const child = index >= 0 ? parent_container.children[index] : undefined

					if (child && !child.position && parent_container.view === 'board') {
						const position = board_position(child, index)
						await this.change_position(id, position, options)
					}

					if (child && !child.size && parent_container.view === 'board') {
						const entry = folder_data.children?.find(c => c.id === id)
						const size = entry?.type === 'folder'
							? FOLDER_PREVIEW_DEFAULT_SIZE
							: board_size(child)
						await this.change_size(id, size, options)
					}
				}
			},

			async change_is_text(id: string, is_text: boolean, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const entity = find_widget(this.folder_container, id)
				if (entity?.type !== 'file') return
				if ((entity.is_text === true) === is_text) return

				await persist_workspace_xattr(
					this,
					fm,
					folder_data,
					id,
					'is_text',
					String(is_text),
					{ tx: options?.tx, before: raw_xattr(folder_data, id, 'is_text') },
				)
			},

			async change_text_width(id: string, mode: 'auto' | 'fixed', options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const entity = find_widget(this.folder_container, id)
				if (entity?.type !== 'file') return
				if ((entity.text_width ?? 'auto') === mode) return

				await persist_workspace_xattr(this, fm, folder_data, id, 'text_width', mode, {
					tx: options?.tx,
					before: raw_xattr(folder_data, id, 'text_width'),
				})
			},

			async show_as_text(id: string, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const before = find_widget(this.folder_container, id)
				if (before?.type !== 'file') return

				// Text first: the cover stays a cover until preview goes on, so the
				// file never shows as a note for the moment between the two writes.
				if (before.is_text !== true) {
					await persist_workspace_xattr(this, fm, folder_data, id, 'is_text', 'true', {
						tx: options?.tx,
						before: raw_xattr(folder_data, id, 'is_text'),
					})
				}
				if (before.is_preview !== true) {
					await persist_workspace_xattr(this, fm, folder_data, id, 'is_preview', 'true', {
						tx: options?.tx,
						before: raw_xattr(folder_data, id, 'is_preview'),
					})
				}

				const parent_container = this.folder_container
				const index = parent_container.children.findIndex(c => c.id === id)
				const child = index >= 0 ? parent_container.children[index] : undefined

				if (child && !child.position && parent_container.view === 'board') {
					await this.change_position(id, board_position(child, index), options)
				}
				// The text size is written whatever the view is: change_is_preview only
				// fills a missing size on a board, and it would ask board_size about
				// the widget before is_text reached the model.
				if (!before.size) {
					await this.change_size(id, TEXT_DEFAULT_SIZE, options)
				}
			},

			async history_write_attr(id: string, name: string, value: string | null, look: boolean) {
				assert_can_write()
				const owner = widget_folder_data(this, id)
					?? (this.folders[id] ? this.folders[id]! : null)
				if (!owner) {
					// Not on screen (a folder that is not open): written to the backend only
					try {
						if (value === null) await fm.remove_xattr(id, name)
						else await fm.set_xattr(id, name, value)
						return true
					} catch (error) {
						report_error(this, error)
						return false
					}
				}
				if (look) return persist_look_xattr(this, fm, owner, id, name as LookName, value)
				if (value === null) {
					return clear_xattr(
						fm,
						owner,
						id,
						name,
						this.preview_folders,
						error => report_error(this, error),
						xattr_hooks(this, owner.id),
					)
				}
				// On screen at once, the way change_position shows a drag before the write
				const live = this.folders[owner.id] ?? owner
				upsert_folder_xattr(live, id, name, value)
				notify_entry_xattr_changed(live, id)
				this.folders[owner.id] = {
					...live,
					xattrs: [...live.xattrs],
					children: live.children?.map(child => ({ ...child, xattrs: [...child.xattrs] })),
				}
				return persist_workspace_xattr(this, fm, this.folders[owner.id]!, id, name, value)
			},

			async history_write_content(id: string, content: string, format: 'note' | 'svg') {
				assert_can_write()
				try {
					await fm.save_text_file(id, content)
				} catch (error) {
					report_error(this, error)
					return false
				}
				if (format === 'svg') content_caches.shapes.set(id, prepare_svg_for_preview(content))
				// A note on screen reloads on a drop (not on a set), and takes the
				// reloaded text as its saved one: its next edit starts from it
				else content_caches.notes.invalidate(id)
				return true
			},

			touch_folder(folder_id: string) {
				const live = this.folders[folder_id]
				if (!live) return
				this.folders[folder_id] = {
					...live,
					xattrs: [...live.xattrs],
					children: live.children?.map(child => ({
						...child,
						xattrs: [...child.xattrs],
					})),
				}
				if (!batch_fs_update_active()) {
					sync_tree_from_folders(this)
				}
			},

			async reload_folder_cache(folder_id: string) {
				bump_folder_cache_generation(folder_id)
				try {
					const folder_data = await fm.folder_with_children_xattrs(folder_id)
					apply_pending_entry_xattrs(folder_data, this.uid)
					this.folders[folder_id] = {
						...folder_data,
						xattrs: [...folder_data.xattrs],
						children: folder_data.children?.map(child => ({
							...child,
							xattrs: [...child.xattrs],
						})),
					}
					this.tree_loaded_folder_ids.add(folder_id)
					sync_tree_from_folders(this)
					bump_folder_cache_generation(folder_id)
				} catch (error) {
					report_error(this, error)
				}
			},

			async run_batch_fs_update<T>(fn: () => Promise<T>): Promise<T> {
				return run_batch_fs_update_impl(fn)
			},

			async reorder_children(folder_id: string, ordered_ids: string[], options?: HistoryOptions) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return false

				const children = folder_data.children ?? []
				const full_order = complete_visible_order(children, ordered_ids)
				if (!full_order) return false
				if (children_orders_match(children, full_order)) return true
				const before = sort_entries_by_order_then_name(children).map(child => child.id)

				const persisted = await persist_children_order(
					this,
					fm,
					folder_id,
					full_order,
				)
				if (!persisted) return false
				options?.tx?.record({ kind: 'order', folder_id, before, after: full_order })
				return true
			},

			async create_note(folder_id: string, position?: Position, options?: HistoryOptions): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const filename = resolve_note_filename(
					(folder_data.children ?? []).map(c => c.name),
				)

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: filename }), async (tx) => {
					const xattrs = [
						{ name: 'is_preview', value: 'true' },
						...(position
							? [{ name: 'position', value: JSON.stringify(position) }]
							: []),
					]
					const node = await create_entry(this, fm, folder_id, 'file', filename, {
						optimistic_id: optimistic_child(folder_id, filename),
						xattrs,
					})
					if (!node) {
						return ''
					}

					// New notes are empty on disk; seed the session cache so a
					// recycled path (e.g. Note 1.md after delete) cannot show
					// stale markdown from a previous file at the same id.
					content_caches.notes.set(node.id, '')
					tx?.record(created_text(node.id, '', 'note', xattrs))
					return node.id
				})
			},

			async create_text(folder_id: string, position?: Position, options?: HistoryOptions): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const filename = resolve_text_block_filename(
					(folder_data.children ?? []).map(c => c.name),
				)

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: filename }), async (tx) => {
					const xattrs = [
						{ name: 'is_preview', value: 'true' },
						{ name: 'is_text', value: 'true' },
						{ name: 'size', value: JSON.stringify(TEXT_DEFAULT_SIZE) },
						...(position
							? [{ name: 'position', value: JSON.stringify(position) }]
							: []),
					]
					const node = await create_entry(this, fm, folder_id, 'file', filename, {
						optimistic_id: optimistic_child(folder_id, filename),
						xattrs,
					})
					if (!node) {
						return ''
					}

					// Same as a note: a recycled path must not show the old file's text.
					content_caches.notes.set(node.id, '')
					// Born selected, so the user sees where it is while typing.
					this.set_selection([node.id])
					tx?.record(created_text(node.id, '', 'note', xattrs))
					return node.id
				})
			},

			async create_shape(
				folder_id: string,
				template: ShapeTemplate,
				position?: Position,
				options?: HistoryOptions,
			): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const filename = resolve_shape_filename(
					(folder_data.children ?? []).map(c => c.name),
				)

				const defaultSize = template === 'line'
					? SHAPE_LINE_DEFAULT_SIZE
					: SHAPE_SQUARE_DEFAULT_SIZE

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: filename }), async (tx) => {
					const content = shape_template_svg(template)
					const xattrs = [
						{ name: 'is_preview', value: 'true' },
						{ name: 'size', value: JSON.stringify(defaultSize) },
						...(position
							? [{ name: 'position', value: JSON.stringify(position) }]
							: []),
					]
					const node = await create_entry(this, fm, folder_id, 'file', filename, {
						optimistic_id: optimistic_child(folder_id, filename),
						content,
						xattrs,
					})
					if (!node) {
						return ''
					}

					tx?.record(created_text(node.id, content, 'svg', xattrs))
					return node.id
				})
			},

			async create_line(
				folder_id: string,
				start: Position,
				end: Position,
				end_plug: LinePlug = 'none',
				options?: HistoryOptions,
			): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const filename = resolve_shape_filename(
					(folder_data.children ?? []).map(c => c.name),
				)

				// Anchor on the press point so nearly-horizontal/vertical lines
			// start exactly where the user pressed.
			const layout = line_layout_from_endpoints(start, end, undefined, {
				point: start,
				which: 'start',
			})
				const svg = build_line_svg({
					width: layout.size.width,
					height: layout.size.height,
					flipX: layout.flipX,
					flipY: layout.flipY,
					axis: layout.axis,
					startPlug: 'none',
					endPlug: end_plug,
					color: SHAPE_LINE_DEFAULT_STROKE,
					strokeWidth: LINE_STROKE_WIDTH,
				})

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: filename }), async (tx) => {
					const xattrs = [
						{ name: 'is_preview', value: 'true' },
						{ name: 'size', value: JSON.stringify(layout.size) },
						{ name: 'position', value: JSON.stringify(layout.position) },
					]
					const node = await create_entry(this, fm, folder_id, 'file', filename, {
						optimistic_id: optimistic_child(folder_id, filename),
						content: svg,
						xattrs,
					})
					if (!node) {
						return ''
					}

					tx?.record(created_text(node.id, svg, 'svg', xattrs))
					return node.id
				})
			},

		async read_note_content(id: string): Promise<string> {
			try {
				return await fm.read_text_file(id)
			} catch (error) {
				// A read the browser cut off (a phone sent the page to the
				// background) is read again once the page is back: not an
				// error to show, and an empty text must not stand for the note.
				if (is_interrupted_error(error)) {
					await page_visible()
					try {
						return await fm.read_text_file(id)
					} catch (again) {
						error = again
					}
				}
				// A read that lost the race with a rename/move is benign —
				// the widget remounts with the new id and re-reads.
				if (!is_missing_path_error(error) && !is_interrupted_error(error)) {
					report_error(this, error)
				}
				return ''
			}
		},

			async get_media_src(id: string, filename: string, options?: { preview?: boolean }) {
				return fm.get_media_src(id, { mimeType: get_mime_type(filename), preview: options?.preview })
			},

		async save_note_content(id: string, new_content: string, options?: HistoryOptions & { before?: string }) {
			assert_can_write()
			try {
				await fm.save_text_file(id, new_content)
			} catch (error) {
				if (!is_missing_path_error(error)) {
					report_error(this, error)
				}
				return false
			}
			if (options?.before !== undefined) {
				options.tx?.record({ kind: 'content', id, format: 'note', before: options.before, after: new_content })
			}
			return true
		},

		...makeSelection(),
		...makeClipboard(),

		// the entry clipboard is global (entry_clipboard); expose the
		// store-scoped view for the ClipboardStore contract
		get clipboard(): ClipboardState {
			const clip = entry_clipboard.current
			return clip
				? {
					mode: clip.mode,
					source_folder_id: clip.source_folder_id,
					entry_ids: clip.entry_ids,
				}
				: null
		},

		async paste(options?: HistoryOptions) {
			assert_can_write()
			const clip = entry_clipboard.current
			if (!clip?.entry_ids.length) return

			const target_folder_id = this.opened_folder_id
			// ids are absolute paths, so a cut no-ops in the source folder even
			// when the paste goes through another store on the same folder
			// (e.g. a second window of the same workspace)
			if (clip.mode === 'cut' && target_folder_id === clip.source_folder_id) return

			const folder_data = this.resolve_folder_data(target_folder_id)
			if (!folder_data) {
				report_error(this, new Error('Open a folder before pasting'))
				return
			}

			// Entries already in the folder: whatever is not among them after
			// the paste arrived with it (a cut and a copy both land under new ids)
			const ids_before = new Set<string>((folder_data.children ?? []).map(child => child.id))

			if (clip.source_store !== this) {
				const created_ids = await transfer_entries({
					source_store: clip.source_store,
					target_store: this,
					entry_ids: clip.entry_ids,
					target_folder_id,
					mode: clip.mode === 'cut' ? 'move' : 'copy',
				})
				if (created_ids.length === 0) return
				await fit_pasted_on_board(this, target_folder_id, ids_before)
				block_history(this, t('undo.op.paste'))

				this.clear_clipboard()
				if (clip.mode === 'cut') clip.source_store.exit_selection_mode()
				return
			}

			if (clip.mode === 'cut') {
				const moving = clip.entry_ids.filter(id => target_folder_id !== id && !is_descendant(this.tree, id, target_folder_id))
				// The cut entries arriving here are one undo
				await own_action(this, options?.tx, { folder_id: target_folder_id }, () => entries_label(this, moving, 'undo.move_entry', 'undo.move_entries'), async (tx) => {
					let insert_index = folder_data.children?.length ?? 0
					for (const id of moving) {
						const moved = await this.move(
							id,
							target_folder_id,
							insert_index,
							clip.source_folder_id,
							undefined,
							{ tx },
						)
						if (moved) insert_index += 1
					}
					await fit_pasted_on_board(this, target_folder_id, ids_before, tx)
				}, { notice: () => entries_label(this, moving, 'undo.moved', 'undo.moved_many') })
				this.clear_clipboard()
				this.exit_selection_mode()
				return
			}

			const created_ids = await own_action(
				this,
				options?.tx,
				{ folder_id: target_folder_id },
				() => entries_label(this, clip.entry_ids, 'undo.paste_one', 'undo.paste_many'),
				async (tx) => {
					const created = await copy_entries_into(this, fm, target_folder_id, clip.entry_ids, tx)
					await fit_pasted_on_board(this, target_folder_id, ids_before, tx)
					return created
				},
			)
			if (created_ids.length === 0) return

			this.clear_clipboard()
		},

		async duplicate_entries(ids: string[], options?: HistoryOptions) {
			assert_can_write()
			const entry_ids = ids.filter(Boolean)
			if (entry_ids.length === 0) return []

			return own_action(
				this,
				options?.tx,
				{ folder_id: this.opened_folder_id },
				() => entries_label(this, entry_ids, 'undo.duplicate_one', 'undo.duplicate_many'),
				tx => copy_entries_into(this, fm, this.opened_folder_id, entry_ids, tx),
			)
		},

			async show_folder_children(
				folder_id: string,
				should_apply?: () => boolean,
				options?: { silent?: boolean; refresh?: boolean },
			) {
				if (!options?.refresh && this.tree_loaded_folder_ids.has(folder_id) && this.folders[folder_id]) {
					sync_tree_from_folders(this)
					return
				}

				const node = find_tree_node(this.tree, folder_id)
				if (!node || node.type !== 'folder') return

				// Drop target during drag needs an empty children array before load finishes.
				if (!node.children) {
					node.children = []
				}

				if (this.is_folder_loading(folder_id)) return

				this.loading_folder_ids.add(folder_id)
				try {
					const folder_data = await fm.folder_with_children_xattrs(folder_id)
					// The caller may cancel applying stale results, e.g. while
					// the tree is being dragged.
					if (should_apply && !should_apply()) return
					this.folders[folder_id] = folder_data
					this.tree_loaded_folder_ids.add(folder_id)
					sync_tree_from_folders(this)
				} catch (error) {
					if (options?.silent) throw error
					report_error(this, error)
				} finally {
					this.loading_folder_ids.delete(folder_id)
				}
			},

			async create_folder(
				folder_id: string,
				position?: Position,
				options?: { view?: FolderView } & HistoryOptions,
			): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const folder_name = resolve_folder_name(
					(folder_data.children ?? []).map(c => c.name),
					t('add.new_folder_name'),
				)

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: folder_name }), async (tx) => {
					const xattrs = [
						{ name: 'view', value: stored_folder_view(options?.view ?? 'board') },
						...(position
							? [
								{ name: 'position', value: JSON.stringify(position) },
								{ name: 'size', value: JSON.stringify(FOLDER_PREVIEW_DEFAULT_SIZE) },
							]
							: []),
					]
					const node = await create_entry(this, fm, folder_id, 'folder', folder_name, {
						optimistic_id: optimistic_child(folder_id, folder_name),
						xattrs,
					})
					if (!node) return ''
					tx?.record({
						kind: 'entry_create',
						id: node.id,
						entry_type: 'folder',
						expect: { children: [] },
						xattrs: Object.fromEntries(xattrs.map(xattr => [xattr.name, xattr.value])),
						recipe: { via: 'folder' },
					})
					return node.id
				})
			},

			async uncombine_folder(folder_id: string, options?: HistoryOptions) {
				assert_can_write()
				if (folder_id === this.id) return

				const parent_id = parent_folder_id_from_node_id(folder_id, this.id)
				if (parent_id === folder_id) return

				const parent_data = this.resolve_folder_data(parent_id)
				const folder_entry = parent_data?.children?.find(c => c.id === folder_id)

				// Capture folder placement before any reloads / moves. Prefer the
				// parent child entry; fall back to the folder's own xattrs and the
				// parsed widget tree (preview merge). Copy to a plain object so a
				// later mutation of the source widget cannot alias this value.
				const folder_position_raw = read_position_attr(
					folder_entry ? xattrs_map(folder_entry.xattrs).position : undefined,
				)
					?? read_position_attr(
						this.folders[folder_id]
							? xattrs_map(this.folders[folder_id]!.xattrs).position
							: undefined,
					)
					?? find_widget(
						to_folder_container(this.opened_folder, this.preview_folders),
						folder_id,
					)?.position
				const folder_position = folder_position_raw
					? { x: folder_position_raw.x, y: folder_position_raw.y }
					: undefined

				// One undo: the folder comes back, its contents go back in at their places
				const label = () => t('undo.ungroup', { name: folder_entry?.name ?? entry_name(this, folder_id) })
				await own_action(this, options?.tx, { folder_id: parent_id }, label, tx => this.run_batch_fs_update(async () => {
					await this.show_folder_children(folder_id)
					await this.ensure_preview_folder(folder_id)

					const folder_data = this.resolve_folder_data(folder_id)
					if (!folder_data) return

					const folder_index = parent_data?.children?.findIndex(c => c.id === folder_id) ?? -1
					let insert_index = folder_index >= 0
						? folder_index
						: (parent_data?.children?.length ?? 0)

					// Snapshot from raw xattrs before position rewrites / moves mutate
					// the children list.
					const child_snapshots = (folder_data.children ?? []).map(child => ({
						id: child.id,
						position: read_position_attr(xattrs_map(child.xattrs).position),
					}))

					// Rewrite to parent-space coords WHILE children still live in the
					// combined folder. The absolute xattr then travels with fm.move —
					// avoiding a post-move change_position race (watch refresh / pending
					// xattrs) that especially hit the origin widget at (pad, pad).
					if (folder_position) {
						for (const { id: child_id, position: child_position } of child_snapshots) {
							await this.change_position(
								child_id,
								absolute_from_origin(
									child_position ?? { x: 0, y: 0 },
									folder_position,
								),
								{ tx },
							)
						}
					}

					for (const { id: child_id } of child_snapshots) {
						await this.move(child_id, parent_id, insert_index, folder_id, undefined, { tx })
						insert_index += 1
					}

					await this.remove(folder_id, { tx })

					await this.reload_folder_cache(parent_id)
				}))
			},

			async create_text_file(folder_id: string, position?: Position, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return ''

				const filename = resolve_text_file_name(
					(folder_data.children ?? []).map(c => c.name),
				)

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: filename }), async (tx) => {
					const xattrs = position
						? [{ name: 'position', value: JSON.stringify(position) }]
						: []
					const node = await create_entry(this, fm, folder_id, 'file', filename, {
						optimistic_id: optimistic_child(folder_id, filename),
						xattrs,
					})
					if (!node) return ''
					tx?.record(created_text(node.id, '', 'plain', xattrs))
					return node.id
				})
			},
			async create_markdown_file(folder_id: string, position?: Position, options?: HistoryOptions) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return ''

				const filename = resolve_markdown_file_name(
					(folder_data.children ?? []).map(c => c.name),
				)

				return own_action(this, options?.tx, { folder_id }, () => t('undo.create_one', { name: filename }), async (tx) => {
					const xattrs = position
						? [{ name: 'position', value: JSON.stringify(position) }]
						: []
					const node = await create_entry(this, fm, folder_id, 'file', filename, {
						optimistic_id: optimistic_child(folder_id, filename),
						xattrs,
					})
					if (!node) return ''
					tx?.record(created_text(node.id, '', 'plain', xattrs))
					return node.id
				})
			},
			async open_file(id: string) {
				if (open_file_hook?.(id)) return
				await this.open_file_externally(id)
			},
			async open_file_externally(id: string) {
				try {
					await fm.open_file(id)
				} catch (error) {
					report_error(this, error)
				}
			},
			async import_external_files(paths: string[], position?: Position, options?: HistoryOptions) {
				assert_can_write()
				if (this.type === 'cloud') {
					let files: File[]
					try {
						files = await read_paths_as_files(paths)
					} catch (error) {
						report_error(this, error)
						return
					}
					// redo reads the paths again rather than keep the bytes
					await this.import_files(this.opened_folder_id, files, position, { tx: options?.tx, paths })
					return
				}
				const folder_id = this.opened_folder_id
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					report_error(this, new Error('Open a folder before importing files'))
					return
				}

				const existing_ids = sort_entries_by_order_then_name(folder_data.children ?? []).map(c => c.id)
				const existing = new Set<string>((folder_data.children ?? []).map(c => c.name))
				const created_ids: string[] = []
				const created_names: string[] = []

				// The files added together are one undo
				await own_action(this, options?.tx, { folder_id }, () => import_label(paths), async (tx) => {
					try {
						for (let index = 0; index < paths.length; index++) {
							const source_path = paths[index]!
							let base_name: string
							try {
								base_name = await basename(source_path)
							} catch (error) {
								report_error(this, error)
								return
							}

							const name = resolve_unique_filename(base_name, existing)
							existing.add(name)

							let node
							try {
								node = await fm.copy_file(source_path, folder_id, name)
							} catch (error) {
								report_error(this, error)
								return
							}

							const xattrs: { name: string; value: string }[] = []
							if (position) {
								const staggered = {
									x: position.x + index * 24,
									y: position.y + index * 24,
								}
								xattrs.push({ name: 'position', value: JSON.stringify(staggered) })
							}

							for (const { name: xattr_name, value } of xattrs) {
								try {
									await fm.set_xattr(node.id, xattr_name, value)
								} catch (error) {
									report_error(this, error)
								}
							}

							apply_entry_created(this, folder_id, {
								id: node.id,
								name: node.name,
								type: 'file',
								xattrs: [...xattrs],
							}, { notice: false })
							created_ids.push(node.id)
							created_names.push(node.name)
							if (tx) {
								// Redo copies the file again, while it is the same size as it was
								const size = await fm.entry_size(node.id).catch(() => undefined)
								tx.record({
									kind: 'entry_create',
									id: node.id,
									entry_type: 'file',
									expect: { size },
									xattrs: Object.fromEntries(xattrs.map(xattr => [xattr.name, xattr.value])),
									recipe: { via: 'copy', source: source_path, external: true, size },
								})
							}
						}

						if (created_ids.length === 0) return

						await persist_children_order(this, fm, folder_id, [
							...existing_ids,
							...created_ids,
						])

						const last_id = created_ids[created_ids.length - 1]
						if (last_id) this.select(last_id)
					} finally {
						note_hidden_names(this, created_names)
					}
				})
			},
			async import_files(folder_id: string, files: File[], position?: Position, options?: HistoryOptions & { paths?: string[] }) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					report_error(this, new Error('Open a folder before importing files'))
					return
				}

				const existing_ids = sort_entries_by_order_then_name(folder_data.children ?? []).map(c => c.id)
				const existing = new Set<string>((folder_data.children ?? []).map(c => c.name))
				const created_ids: string[] = []
				const created_names: string[] = []

				// The files added together are one undo
				await own_action(this, options?.tx, { folder_id }, () => import_label(files.map(file => file.name)), async (tx) => {
					try {
						for (let index = 0; index < files.length; index++) {
							const file = files[index]!
							const name = resolve_unique_filename(file.name, existing)
							existing.add(name)

							this.import_progress = {
								file_name: file.name,
								file_index: index + 1,
								total_files: files.length,
								loaded_bytes: 0,
								total_bytes: file.size,
							}

							let node
							try {
								node = await fm.upload_file(folder_id, name, file, file.type || undefined, (loaded, total) => {
									if (this.import_progress) {
										this.import_progress.loaded_bytes = loaded
										this.import_progress.total_bytes = total
									}
								})
							} catch (error) {
								report_error(this, error)
								return
							}

							const xattrs: { name: string; value: string }[] = []
							if (position) {
								const staggered = {
									x: position.x + index * 24,
									y: position.y + index * 24,
								}
								xattrs.push({ name: 'position', value: JSON.stringify(staggered) })
							}

							for (const { name: xattr_name, value } of xattrs) {
								try {
									await fm.set_xattr(node.id, xattr_name, value)
								} catch (error) {
									report_error(this, error)
								}
							}

							apply_entry_created(this, folder_id, {
								id: node.id,
								name: node.name,
								type: 'file',
								xattrs: [...xattrs],
							}, { notice: false })
							created_ids.push(node.id)
							created_names.push(node.name)
							if (tx) {
								// Redo uploads it again: from its path on the desktop, from the File in the browser
								const path = options?.paths?.[index]
								tx.record({
									kind: 'entry_create',
									id: node.id,
									entry_type: 'file',
									expect: { size: await fm.entry_size(node.id).catch(() => file.size) },
									xattrs: Object.fromEntries(xattrs.map(xattr => [xattr.name, xattr.value])),
									recipe: { via: 'upload', file: path ? undefined : file, path, mime: file.type || undefined, size: file.size },
								})
							}
						}

						if (created_ids.length === 0) return

						await persist_children_order(this, fm, folder_id, [
							...existing_ids,
							...created_ids,
						])

						const last_id = created_ids[created_ids.length - 1]
						if (last_id) this.select(last_id)
					} finally {
						// After every file, including a failed upload: the window clears
						// a notice as soon as it shows it, so a per-file notice would toast
						// once per hidden import.
						note_hidden_names(this, created_names)
						this.import_progress = null
					}
				})
			},
			async remove(id: string, options?: HistoryOptions) {
				assert_can_write()
				const owner_folder_id = removed_owner_folder_id(this, id)
				const folder_id = owner_folder_id ?? parent_folder_id_from_node_id(id, this.id)
				const removed_name = entry_name(this, id)
				const label = () => t('undo.remove_one', { name: removed_name })
				await own_action(this, options?.tx, { folder_id }, label, async (tx) => {
					const entry_type = cached_entry_type(this, id)
					const edges = owner_folder_id ? edges_to(this, owner_folder_id, id) : []
					// the sync forgets the cloud row right after its pass: kept for the undo
					const sync = tx ? await locate_synced(this, id) : undefined
					let receipt: RemoveReceipt | null = null
					try {
						if (tx && fm.remove_with_receipt) receipt = await fm.remove_with_receipt(id)
						else await fm.remove(id)
					} catch (error) {
						report_error(this, error)
						return
					}
					// To the trash with a way back; otherwise the delete is final
					if (tx && receipt) tx.record({ kind: 'entry_delete', id, entry_type, receipt, folder_id, edges, ...(sync ? { sync } : {}) })
					else block_history(this, t('undo.op.remove', { name: removed_name }))
					await forget_removed(this, id, owner_folder_id)
				}, { notice: () => t('undo.removed', { name: removed_name }) })
			},

			async remove_entries(ids: string[], options?: HistoryOptions) {
				if (ids.length === 1) return this.remove(ids[0]!, options)
				if (ids.length === 0) return
				assert_can_write()
				const first = ids[0]!
				const folder_id = removed_owner_folder_id(this, first) ?? parent_folder_id_from_node_id(first, this.id)
				const label = () => entries_label(this, ids, 'undo.remove_one', 'undo.remove_many')
				await own_action(this, options?.tx, { folder_id }, label, async (tx) => {
					for (const id of ids) await this.remove(id, { tx })
				}, { notice: () => t('undo.removed_many', { count: count_items(ids.length) }) })
			},

			async history_restore_removed(step: DeleteStep) {
				assert_can_write()
				const synced = step.sync ? synced_folders() : null
				if (!synced || !step.sync) return restore_removed_here(this, step)
				const { root, cloud_id } = step.sync
				// Both sides while the folder's passes wait: the cloud row first, then
				// the file, so that no pass in between uploads or downloads it again
				return synced.hold(root, async () => {
					// A pass before the hold may have brought a changed cloud copy down
					if (await entry_there(fm, step.id, this.id)) return 'taken' as const
					if (cloud_id) {
						try {
							if ((await synced.row_state(cloud_id)) === 'trashed') await synced.restore_row(cloud_id)
						} catch (error) {
							// the file still comes back; the next pass uploads it
							report_error(this, error)
						}
					}
					return restore_removed_here(this, step)
				})
			},

			async history_remove_again(id: string) {
				assert_can_write()
				if (!fm.remove_with_receipt) return false
				const owner_folder_id = removed_owner_folder_id(this, id)
				const edges = owner_folder_id ? edges_to(this, owner_folder_id, id) : []
				const sync = await locate_synced(this, id)
				let receipt: RemoveReceipt | null
				try {
					receipt = await fm.remove_with_receipt(id)
				} catch (error) {
					report_error(this, error)
					return false
				}
				await forget_removed(this, id, owner_folder_id)
				// A trash that gave no ticket this time: the next undo says it cannot bring it back
				return { receipt: receipt ?? { id, ticket: '' }, edges, sync }
			},

			async history_remove_created(id: string, expect: CreateStep['expect']) {
				assert_can_write()
				const owner_folder_id = removed_owner_folder_id(this, id)
				const remove_here = async () => {
					let outcome: 'removed' | 'changed' | 'gone'
					try {
						outcome = fm.remove_untouched
							? await fm.remove_untouched(id, expect)
							: await remove_untouched_by_reads(fm, id, parent_folder_id_from_node_id(id, this.id), expect)
					} catch (error) {
						report_error(this, error)
						return false as const
					}
					if (outcome !== 'changed') await forget_removed(this, id, owner_folder_id)
					return outcome
				}
				const synced = synced_folders()
				const found = await locate_synced(this, id)
				if (!synced || !found) return remove_here()
				// In a synced folder its cloud copy goes for good too, while the passes
				// wait: otherwise the next pass sends it to the cloud trash
				return synced.hold(found.root, async () => {
					const outcome = await remove_here()
					if (outcome === false || outcome === 'changed') return outcome
					const entry = await locate_synced(this, id)
					if (entry?.cloud_id) await synced.remove_copy(entry, expect).catch(error => report_error(this, error))
					return outcome
				})
			},

			async history_create_again(step: CreateStep) {
				assert_can_write()
				const parent = parent_folder_id_from_node_id(step.id, this.id)
				const name = path_name(step.id)
				const xattrs = Object.entries(step.xattrs).map(([xattr_name, value]) => ({ name: xattr_name, value }))
				const recipe = step.recipe
				if (recipe.via === 'text' || recipe.via === 'folder') {
					const node = await create_entry(this, fm, parent, recipe.via === 'folder' ? 'folder' : 'file', name, {
						content: recipe.via === 'text' ? recipe.content : undefined,
						xattrs,
						optimistic_id: optimistic_child(parent, name),
					})
					if (!node) return false
					if (recipe.via === 'text' && recipe.format === 'note') content_caches.notes.set(node.id, recipe.content)
					if (recipe.via === 'text' && recipe.format === 'svg') content_caches.shapes.set(node.id, prepare_svg_for_preview(recipe.content))
					return { id: node.id }
				}
				const source_changed = { message: t('undo.source_changed', { name }) }
				let node: FolderChild
				try {
					if (recipe.via === 'copy' && recipe.external) {
						// A file from outside is copied again only while it is the same size as then
						const size = await fm.entry_size(recipe.source).catch(() => null)
						if (size === null || (recipe.size !== undefined && size !== recipe.size)) return source_changed
						node = await fm.copy_file(recipe.source, parent, name)
					} else if (recipe.via === 'copy') {
						node = await fm.copy_entry(recipe.source, parent, name)
					} else {
						const file = recipe.path
							? (await read_paths_as_files([recipe.path]).catch(() => [] as File[]))[0]
							: recipe.file
						if (!file || file.size !== recipe.size) return source_changed
						node = await fm.upload_file(parent, name, file, recipe.mime)
					}
				} catch (error) {
					// A browser File whose file changed on disk can no longer be read
					if (recipe.via === 'upload') return source_changed
					report_error(this, error)
					return false
				}
				for (const { name: xattr_name, value } of xattrs) {
					try {
						await fm.set_xattr(node.id, xattr_name, value)
					} catch (error) {
						report_error(this, error)
					}
				}
				apply_entry_created(this, parent, { id: node.id, name: node.name, type: node.type, xattrs: [...xattrs] }, { notice: false })
				return { id: node.id }
			},

			async history_move_entry(from: string, to: string) {
				assert_can_write()
				const from_parent = parent_folder_id_from_node_id(from, this.id)
				const to_parent = parent_folder_id_from_node_id(to, this.id)
				// rename and move find the entry in the tree: its folder (and theirs) must be read
				for (const folder_id of folder_ancestor_chain(from_parent, this.id)) {
					if (this.tree_loaded_folder_ids.has(folder_id) && this.folders[folder_id]) continue
					try {
						await this.show_folder_children(folder_id, undefined, { silent: true })
					} catch (error) {
						report_error(this, error)
						return false
					}
				}
				if (from_parent === to_parent) {
					try {
						return (await this.rename(from, path_name(to), { report: false })) ?? false
					} catch (error) {
						report_error(this, error)
						return false
					}
				}
				// A name taken meanwhile: it lands as the store names it, and the history follows
				return (await this.move(from, to_parent, Number.MAX_SAFE_INTEGER, from_parent)) ?? false
			},
			async rename(id: string, new_name: string, options?: { report?: boolean } & HistoryOptions) {
				assert_can_write()
				const name = new_name.trim()
				if (!name) return undefined

				const tree_node = find_tree_node(this.tree, id)
				const folder_entry = find_child_entry(this.folders, id)
				const is_opened_folder = this.opened_folder_id === id

				if (
					tree_node?.name === name
					|| folder_entry?.name === name
					|| (is_opened_folder && this.opened_folder.name === name)
				) {
					return id
				}

				if (!tree_node && !folder_entry && !is_opened_folder) return undefined
				const entry_type = folder_entry?.type ?? tree_node?.type ?? (is_opened_folder ? 'folder' : 'file')
				const shown_name = folder_entry?.name ?? tree_node?.name ?? (is_opened_folder ? this.opened_folder.name : id)

				return own_action(this, options?.tx, { entry_id: id }, () => t('undo.rename', { name: shown_name }), async (tx) => {
				// Cloud: the new name (and the paths under it) shows at once; the
				// request holds every later call that names the entry, and a refusal
				// puts the old name back and says why
				const expected = optimistic_child(parent_folder_id_from_node_id(id, this.id), name)
				const old_name = folder_entry?.name ?? tree_node?.name ?? (is_opened_folder ? this.opened_folder.name : undefined)
				const shown_early = expected !== undefined && expected !== id && old_name !== undefined
				if (shown_early) {
					rekey_entry_content_caches(content_caches, id, expected)
					apply_id_changed(this, id, expected, name)
				}
				const request = fm.rename(id, name)
				if (shown_early) hold_entry(fm, expected, request, { replaces: id })
				let result
				try {
					result = await request
				} catch (error) {
					if (shown_early) {
						rekey_entry_content_caches(content_caches, expected, id)
						apply_id_changed(this, expected, id, old_name)
					}
					if (options?.report === false) throw error
					report_error(this, error)
					return undefined
				}

		const shown_id = shown_early ? expected : id
		if (result.id !== shown_id || !shown_early) {
			rekey_entry_content_caches(content_caches, shown_id, result.id)
			apply_id_changed(this, shown_id, result.id, result.name)
		}
		note_hidden_name(this, result.name)
		await rename_folder_canvas_connections(this, id, result.id)
		tx?.record({ kind: 'entry_move', from: id, to: result.id, entry_type: entry_type === 'folder' ? 'folder' : 'file' })
		return result.id
				})
	},

			async move(
				id: string,
				target_folder_id: string,
				new_index: number,
				source_folder_id?: string,
				_source_index?: number,
				options?: HistoryOptions,
			): Promise<string | undefined> {
				assert_can_write()
				const node = find_tree_node(this.tree, id)
				if (!node) return

				const current = find_tree_parent(this.tree, id)
				const resolved_source_folder_id = source_folder_id
					?? parent_folder_id_from_node_id(id, this.id)

				const current_parent_folder_id = current
					? find_folder_id_for_list(this.tree, this.id, current.parent_list)
					: null
				const already_in_target = current_parent_folder_id === target_folder_id

				const revert_to_folders = () => {
					sync_tree_from_folders(this)
				}

				if (target_folder_id === id || is_descendant(this.tree, id, target_folder_id)) {
					revert_to_folders()
					return
				}

				const is_cross_folder = resolved_source_folder_id !== undefined
					&& resolved_source_folder_id !== target_folder_id

				if (is_cross_folder) {
					bump_folder_cache_generation(resolved_source_folder_id)
					bump_folder_cache_generation(target_folder_id)
				}

				if (!is_cross_folder) {
					const list = folder_children_list(this.tree, this.id, target_folder_id)
					if (!list) {
						revert_to_folders()
						return
					}

					const folder_data = this.resolve_folder_data(target_folder_id)
					const full_order = complete_visible_order(
						folder_data?.children ?? [],
						list.map(n => n.id),
					)
					if (!full_order) {
						revert_to_folders()
						return
					}
					const before_order = sort_entries_by_order_then_name(folder_data?.children ?? []).map(child => child.id)

					return own_action(this, options?.tx, { folder_id: target_folder_id }, () => t('undo.order'), async (tx) => {
						const persisted = await persist_children_order(
							this,
							fm,
							target_folder_id,
							full_order,
						)
						if (!persisted) {
							revert_to_folders()
							return undefined
						}
						tx?.record({ kind: 'order', folder_id: target_folder_id, before: before_order, after: full_order })
						return undefined
					})
				}

				return own_action(this, options?.tx, { folder_id: resolved_source_folder_id }, () => t('undo.move_entry', { name: node.name }), async (tx) => {
				const is_workspace_root = target_folder_id === this.id

				if (!is_workspace_root) {
					if (!this.tree_loaded_folder_ids.has(target_folder_id) || !this.folders[target_folder_id]) {
						await this.show_folder_children(target_folder_id)
					} else if (!find_tree_node(this.tree, target_folder_id)) {
						// Cache seeded (e.g. combine create_folder) while batched fs
						// updates skipped tree projection — move must see the target.
						sync_tree_from_folders(this)
					}
					this.expanded_folder_ids.add(target_folder_id)
					this.tree_loaded_folder_ids.add(target_folder_id)
				}

				const target_folder = is_workspace_root
					? null
					: find_tree_node(this.tree, target_folder_id)
				if (!is_workspace_root && (!target_folder || target_folder.type !== 'folder')) {
					revert_to_folders()
					return
				}

				const source_data = resolved_source_folder_id
					? this.resolve_folder_data(resolved_source_folder_id)
					: null
				let target_data = this.resolve_folder_data(target_folder_id)
				if (!target_data && target_folder_id !== this.id) {
					await this.ensure_preview_folder(target_folder_id)
					target_data = this.resolve_folder_data(target_folder_id)
				}
				if (target_folder_id === this.id) {
					target_data = this.resolve_folder_data(this.id)
				}

				const entry = source_data?.children?.find(c => c.id === id)
					?? {
						id,
						name: node.name,
						type: node.type,
						xattrs: [] as { name: string; value: string }[],
					}

				// Snapshot for revert
				const source_children_before = source_data ? [...(source_data.children ?? [])] : null
				const target_children_before = target_data ? [...(target_data.children ?? [])] : null

				const revert_folders = () => {
					if (source_data && source_children_before) {
						source_data.children = source_children_before
					}
					if (target_data && target_children_before) {
						target_data.children = target_children_before
					}
					maybe_sync_tree_from_folders(this)
				}

				if (!already_in_target) {
					if (source_data?.children) {
						const idx = source_data.children.findIndex(c => c.id === id)
						if (idx !== -1) source_data.children.splice(idx, 1)
					}
					if (target_data) {
						if (!target_data.children) target_data.children = []
						if (!target_data.children.some(c => c.id === id)) {
							const insert_at = Math.min(new_index, target_data.children.length)
							target_data.children.splice(insert_at, 0, { ...entry })
						}
					}
					maybe_sync_tree_from_folders(this)
				} else if (source_data && target_data && source_data !== target_data) {
					// vuedraggable already moved the tree node; align folders.
					const idx = source_data.children?.findIndex(c => c.id === id) ?? -1
					if (idx !== -1) source_data.children!.splice(idx, 1)
					if (!target_data.children) target_data.children = []
					if (!target_data.children.some(c => c.id === id)) {
						const insert_at = Math.min(new_index, target_data.children.length)
						target_data.children.splice(insert_at, 0, { ...entry })
					}
					maybe_sync_tree_from_folders(this)
				}

				const target_list = folder_children_list(this.tree, this.id, target_folder_id)
				const move_name = resolve_unique_filename(
					node.name,
					target_list?.filter(n => n.id !== id).map(n => n.name) ?? [],
				)

				const old_id = id
				let result
				try {
					result = await fm.move(old_id, target_folder_id, move_name)
				} catch (error) {
					report_error(this, error)
					revert_folders()
					return
				}

				// Entry should sit under the target with the old id so
				// apply_id_changed can rewrite it; avoid a duplicate push.
				if (target_data) {
					if (!target_data.children) target_data.children = []
					const has_old = target_data.children.some(c => c.id === old_id)
					const has_new = target_data.children.some(c => c.id === result.id)
					if (!has_old && !has_new) {
						target_data.children.push({
							id: old_id,
							name: node.name,
							type: node.type,
							xattrs: [],
						})
					}
				}

			rekey_entry_content_caches(content_caches, old_id, result.id)
			apply_id_changed(this, old_id, result.id, result.name)

		await rename_folder_canvas_connections(this, old_id, result.id, {
			same_parent: !is_cross_folder,
		})

		if (is_cross_folder && resolved_source_folder_id) {
			await move_folder_canvas_connections(
				this,
				this,
				old_id,
				result.id,
				resolved_source_folder_id,
				target_folder_id,
			)
		}

				// Cross-folder moves splice children in-place. Views that track
				// folders[id] by reference need a shallow clone — but skip during
				// batched combine/uncombine; reload_folder_cache handles the final paint.
				if (is_cross_folder && !batch_fs_update_active()) {
					this.touch_folder(resolved_source_folder_id)
					this.touch_folder(target_folder_id)
				}

				tx?.record({ kind: 'entry_move', from: old_id, to: result.id, entry_type: node.type === 'folder' ? 'folder' : 'file' })
				return result.id
				}, { notice: () => t('undo.moved', { name: node.name }) })
			},

			open(widget: FolderContainerWidgetChild) {
				if (widget.type === 'file') return void this.open_file(widget.id)
				if (open_folder_hook) return void open_folder_hook(widget.id)
				void this.open_folder(widget.id)
			},

			set_open_folder_hook(hook: ((folder_id: string) => unknown) | null) {
				open_folder_hook = hook
			},

			set_open_file_hook(hook: ((file_id: string) => boolean) | null) {
				open_file_hook = hook
			},
		})

		stop_show_hidden_watch = watch([show_hidden_files, hidden_paths], () => {
			sync_tree_from_folders(workspace)
		}, { deep: true })

		if (shallow_root) {
			// One subscription for every change to the open branch, including
			// a rename or a delete that rewrites the set from outside this file.
			stop_shallow_watch = watch(
				() => [...workspace.expanded_folder_ids, workspace.opened_folder_id],
				() => { void reconcile_shallow_watches(workspace) },
				{ flush: 'sync' },
			)
		}

		// The first watch (the cloud channel's join) does not hold the store back;
		// became_live re-reads what was shown before it
		if (watch_live) await active_step('root_watch', () => start_watching(workspace, root_folder_id))
		else void start_watching(workspace, root_folder_id)
		return workspace
	} catch (error) {
		console.error(error)
		return null
	}
}

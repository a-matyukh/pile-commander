import { markRaw, reactive } from 'vue'
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
	type WorkspaceState,
} from '../services/workspace/mutations'
import { path_separator } from '../services/workspace/paths'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import type { ClipboardState, WorkspaceStore, WorkspaceTab, ImportProgress } from '../domain/Store'
import type { WorkspaceTree } from '@/domain/WorkspaceTree'
import {
	FolderWithChildrenXattrs,
	type ConnectionsWatchEvent,
	type FileManager,
	type StrokesWatchEvent,
	type Unwatch,
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
} from '../services/workspace/folderContainer'
import { persist_xattr, find_entry_owner_folder, xattrs_map, upsert_folder_xattr, notify_entry_xattr_changed, apply_pending_entry_xattrs, bump_folder_cache_generation } from '../services/workspace/xattrs'
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
	resolve_text_file_name,
	resolve_unique_filename,
} from '../services/naming/uniqueName'
import type { ShapeTemplate } from '@/domain/shapes'
import {
	Color,
	Connection,
	FolderContainerWidgetChild,
	FolderView,
	ImageBase64,
	ModelCameraState,
	Position,
	Size,
	StrokeNode,
} from '@/domain/Widget'
import { board_position, board_size, absolute_from_origin, read_position_attr, FOLDER_PREVIEW_DEFAULT_SIZE, SHAPE_LINE_DEFAULT_SIZE, SHAPE_SQUARE_DEFAULT_SIZE } from '@/services/board/layout'
import { get_mime_type } from '@/services/board/media'
import { basename } from '@tauri-apps/api/path'
import { report_error } from './helpers/reportError'
import { user_message_for_watch_error } from './helpers/watchSubscribeError'
import { read_paths_as_files } from '@/services/workspace/pathsToFiles'
import { find_widget, widget_folder_data } from './helpers/widgetHelpers'
import { persist_children_order } from './helpers/persistChildrenOrder'
import {
	move_folder_canvas_connections,
	prune_folder_canvas_connections,
	rename_folder_canvas_connections,
	type CanvasPersistStore,
} from './helpers/persistCanvas'
import {
	cached_folders_affected_by,
	refresh_cached_folder,
} from './helpers/refreshCachedFolder'
import { is_missing_path_error } from './helpers/fsErrors'
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
}

function persist_workspace_xattr(
	store: PersistXattrStore,
	fm: Pick<FileManager, 'set_xattr'>,
	folder_data: FolderWithChildrenXattrs,
	id: string,
	name: string,
	value: string,
) {
	const owner_id = folder_data.id
	return persist_xattr(
		fm,
		folder_data,
		id,
		name,
		value,
		store.preview_folders,
		(error) => report_error(store, error),
		{
			resolve_folder: () => store.folders[owner_id],
			replace_folder: (next) => {
				store.folders[owner_id] = next
			},
		},
	)
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
}

export async function createWorkspaceStore(
	ws: WorkspacesListItem,
	fm: FileManager,
	{ root_folder_id = ws.id, can_write = true, live = true }: WorkspaceStoreOptions = {},
): Promise<WorkspaceStore | null> {
	const opened_folder: FolderWithChildrenXattrs = await fm.folder_with_children_xattrs(root_folder_id)

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
	let disposed = false

	/** Stable identity for `preview_folders` while folder keys / opened id are unchanged. */
	let preview_folders_cache: {
		opened_id: string
		folder_keys: string
		value: Record<string, FolderWithChildrenXattrs>
	} | null = null

	const stop_watching = () => {
		unwatch?.()
		unwatch = null
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

	const start_watching = async (
		store: WorkspaceState & CanvasPersistStore & { content_caches: EntryContentCaches },
		folder_id: string,
	) => {
		if (!live) return
		const generation = ++watch_generation
		try {
			// Subscribe before releasing the previous watch: the cloud fm shares
			// one entries channel, which then stays joined across navigation
			// instead of a leave/join per opened folder
			const next = await fm.watch(
				folder_id,
				(event) => {
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
				},
				{ recursive: true },
			)
			if (disposed || generation !== watch_generation) {
				next()
				return
			}
			unwatch?.()
			unwatch = next
		} catch (error) {
			const message = user_message_for_watch_error(error)
			if (message === null) {
				console.error(error)
				return
			}
			report_error(store, new Error(message))
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
		const workspace: WorkspaceStore = reactive({
			id: root_folder_id,
			uid: ws.id,
			type: ws.type,
			name: ws.name,
			can_write,
			live,
			file_manager: fm,

		last_error: null as string | null,
		clear_error() {
			this.last_error = null
		},

		import_progress: null as ImportProgress | null,

		dispose() {
			disposed = true
			stop_watching()
			stop_watching_strokes()
			stop_watching_connections()
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
				try {
					folder_data = await fm.folder_with_children_xattrs(folder_id)
				} catch (error) {
					report_error(this, error)
					return
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
			await this.navigate_open_folder(folder_id, options)
		},

		async navigate_open_folder(
			folder_id: string,
			options?: { fromBack?: boolean; skipHistory?: boolean; force?: boolean },
		) {
			if (!options?.force && folder_id === this.opened_folder_id) return

			this.exit_selection_mode()

			if (!options?.fromBack && !options?.skipHistory) {
				this.folder_back_stack.push(this.opened_folder_id)
			}

		this.opening_folder_id = folder_id
		let folder_data: FolderWithChildrenXattrs
		try {
			folder_data = await fm.folder_with_children_xattrs(folder_id)
			this.folders[folder_id] = folder_data
			this.opened_folder_id = folder_id
		} finally {
			this.opening_folder_id = null
		}
		await this.prefetch_preview_folders(folder_data.children)

		if (folder_id === this.id || find_tree_node(this.tree, folder_id)) {
			this.tree_loaded_folder_ids.add(folder_id)
			sync_tree_from_folders(this)
		}

	await start_watching(this, folder_id)
	void this.ensure_strokes(folder_id)
	void this.ensure_connections(folder_id)
	await this.expand_folder_in_sidebar(folder_id)
},

			async change_folder_view(folder_id: string, new_view: FolderView) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const container = to_folder_container(folder_data, this.preview_folders)
				if (container.view === new_view) {
					return
				}
				await persist_workspace_xattr(this, fm, folder_data, folder_id, 'view', new_view)
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
					report_error(this, error)
				} finally {
					connections_pending.delete(folder_id)
				}
			})()
			connections_pending.set(folder_id, load)
			return load
		},

		async upsert_connections(folder_id: string, connections: Connection[]) {
			assert_can_write()
			if (connections.length === 0) return

			const by_id = new Map<string, Connection>(
				(this.connections_by_folder[folder_id] ?? []).map(connection => [connection.id, connection]),
			)
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
			}
		},

		async delete_connections(folder_id: string, connection_ids: string[]) {
			assert_can_write()
			if (connection_ids.length === 0) return

			const doomed = new Set(connection_ids)
			const current = this.connections_by_folder[folder_id]
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
			}
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
						report_error(this, error)
					} finally {
						strokes_pending.delete(folder_id)
					}
				})()
				strokes_pending.set(folder_id, load)
				return load
			},

			async upsert_strokes(folder_id: string, strokes: StrokeNode[]) {
				assert_can_write()
				if (strokes.length === 0) return

			const by_id = new Map<string, StrokeNode>(
				(this.strokes_by_folder[folder_id] ?? []).map(stroke => [stroke.id, stroke]),
			)
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
				}
			},

			async delete_strokes(folder_id: string, stroke_ids: string[]) {
				assert_can_write()
				if (stroke_ids.length === 0) return

				const doomed = new Set(stroke_ids)
				const current = this.strokes_by_folder[folder_id]
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
				}
			},

			async change_background(id: string, new_background: ImageBase64 | Color) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				if (entity?.background === new_background) {
					return
				}
				await persist_workspace_xattr(this, fm, folder_data, id, 'background', new_background)
			},

			async change_shape_fill(id: string, color: Color) {
				assert_can_write()
				try {
					const raw = await fm.read_text_file(id)
					const updated = apply_shape_color(raw, color)
					if (updated === raw) return

				await fm.save_text_file(id, updated)
				const prepared = prepare_svg_for_preview(updated)
				content_caches.shapes.set(id, prepared)
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
				await this.change_position(id, geometry.position)
				await this.change_size(id, geometry.size)
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
			} catch (error) {
				report_error(this, error)
			}
		},

		async change_cover(id: string, new_cover: Color) {
				assert_can_write()
				const folder_data = widget_folder_data(this, id)
				if (!folder_data) return

				const container = to_folder_container(this.opened_folder, this.preview_folders)
				const entity = find_widget(container, id)
				if (entity && 'cover' in entity && entity.cover === new_cover) {
					return
				}
				await persist_workspace_xattr(this, fm, folder_data, id, 'cover', new_cover)
			},

			async change_position(id: string, new_position: Position) {
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
				)
			},

			async change_size(id: string, new_size: Size) {
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

			async change_is_preview(id: string, is_preview: boolean) {
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
						await this.change_position(id, position)
					}

					if (child && !child.size && parent_container.view === 'board') {
						const entry = folder_data.children?.find(c => c.id === id)
						const size = entry?.type === 'folder'
							? FOLDER_PREVIEW_DEFAULT_SIZE
							: board_size(child)
						await this.change_size(id, size)
					}
				}
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
					apply_pending_entry_xattrs(folder_data)
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

			async reorder_children(folder_id: string, ordered_ids: string[]) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const children = folder_data.children ?? []
				if (ordered_ids.length !== children.length) {
					return
				}
				const ids = new Set(children.map(c => c.id))
				if (!ordered_ids.every(id => ids.has(id))) {
					return
				}
				if (children_orders_match(children, ordered_ids)) {
					return
				}

				const persisted = await persist_children_order(
					this,
					fm,
					folder_id,
					ordered_ids,
				)
				if (!persisted) {
					return
				}
			},

			async create_note(folder_id: string, position?: Position): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const filename = resolve_note_filename(
					(folder_data.children ?? []).map(c => c.name),
				)

				const node = await create_entry(this, fm, folder_id, 'file', filename, {
					xattrs: [
						{ name: 'is_preview', value: 'true' },
						...(position
							? [{ name: 'position', value: JSON.stringify(position) }]
							: []),
					],
				})
				if (!node) {
					return ''
				}

			// New notes are empty on disk; seed the session cache so a
			// recycled path (e.g. Note 1.md after delete) cannot show
			// stale markdown from a previous file at the same id.
			content_caches.notes.set(node.id, '')
				return node.id
			},

			async create_shape(
				folder_id: string,
				template: ShapeTemplate,
				position?: Position,
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

				const node = await create_entry(this, fm, folder_id, 'file', filename, {
					content: shape_template_svg(template),
					xattrs: [
						{ name: 'is_preview', value: 'true' },
						{ name: 'size', value: JSON.stringify(defaultSize) },
						...(position
							? [{ name: 'position', value: JSON.stringify(position) }]
							: []),
					],
				})
				if (!node) {
					return ''
				}

				return node.id
			},

			async create_line(
				folder_id: string,
				start: Position,
				end: Position,
				end_plug: LinePlug = 'none',
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

				const node = await create_entry(this, fm, folder_id, 'file', filename, {
					content: svg,
					xattrs: [
						{ name: 'is_preview', value: 'true' },
						{ name: 'size', value: JSON.stringify(layout.size) },
						{ name: 'position', value: JSON.stringify(layout.position) },
					],
				})
				if (!node) {
					return ''
				}

				return node.id
			},

		async read_note_content(id: string): Promise<string> {
			try {
				return await fm.read_text_file(id)
			} catch (error) {
				// A read that lost the race with a rename/move is benign —
				// the widget remounts with the new id and re-reads.
				if (!is_missing_path_error(error)) {
					report_error(this, error)
				}
				return ''
			}
		},

			async get_media_src(id: string, filename: string) {
				return fm.get_media_src(id, { mimeType: get_mime_type(filename) })
			},

		async save_note_content(id: string, new_content: string) {
			assert_can_write()
			try {
				await fm.save_text_file(id, new_content)
			} catch (error) {
				if (!is_missing_path_error(error)) {
					report_error(this, error)
				}
			}
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

		async paste() {
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

			if (clip.source_store !== this) {
				const created_ids = await transfer_entries({
					source_store: clip.source_store,
					target_store: this,
					entry_ids: clip.entry_ids,
					target_folder_id,
					mode: clip.mode === 'cut' ? 'move' : 'copy',
				})
				if (created_ids.length === 0) return

				this.clear_clipboard()
				if (clip.mode === 'cut') clip.source_store.exit_selection_mode()
				return
			}

			if (clip.mode === 'cut') {
					let insert_index = folder_data.children?.length ?? 0
					for (const id of clip.entry_ids) {
						if (target_folder_id === id || is_descendant(this.tree, id, target_folder_id)) {
							continue
						}
						const moved = await this.move(
							id,
							target_folder_id,
							insert_index,
							clip.source_folder_id,
						)
						if (moved) insert_index += 1
					}
					this.clear_clipboard()
					this.exit_selection_mode()
					return
				}

				const created_ids = await copy_entries_into(
					this,
					fm,
					target_folder_id,
					clip.entry_ids,
				)
				if (created_ids.length === 0) return

				this.clear_clipboard()
			},

			async duplicate_entries(ids: string[]) {
				assert_can_write()
				const entry_ids = ids.filter(Boolean)
				if (entry_ids.length === 0) return

				await copy_entries_into(this, fm, this.opened_folder_id, entry_ids)
			},

			async show_folder_children(folder_id: string, should_apply?: () => boolean) {
				if (this.tree_loaded_folder_ids.has(folder_id) && this.folders[folder_id]) {
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
					report_error(this, error)
				} finally {
					this.loading_folder_ids.delete(folder_id)
				}
			},

			async create_folder(
				folder_id: string,
				position?: Position,
				options?: { view?: FolderView },
			): Promise<string> {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					return ''
				}

				const folder_name = resolve_folder_name(
					(folder_data.children ?? []).map(c => c.name),
				)

				const node = await create_entry(this, fm, folder_id, 'folder', folder_name, {
					xattrs: [
						{ name: 'view', value: options?.view ?? 'board' },
						...(position
							? [
								{ name: 'position', value: JSON.stringify(position) },
								{ name: 'size', value: JSON.stringify(FOLDER_PREVIEW_DEFAULT_SIZE) },
							]
							: []),
					],
				})
				return node?.id ?? ''
			},

			async uncombine_folder(folder_id: string) {
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

				await this.run_batch_fs_update(async () => {
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
							)
						}
					}

					for (const { id: child_id } of child_snapshots) {
						await this.move(child_id, parent_id, insert_index, folder_id)
						insert_index += 1
					}

					await this.remove(folder_id)

					await this.reload_folder_cache(parent_id)
				})
			},

			async create_text_file(folder_id: string, position?: Position) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const filename = resolve_text_file_name(
					(folder_data.children ?? []).map(c => c.name),
				)

				await create_entry(this, fm, folder_id, 'file', filename, {
					xattrs: position
						? [{ name: 'position', value: JSON.stringify(position) }]
						: [],
				})
			},
			async create_markdown_file(folder_id: string, position?: Position) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) return

				const filename = resolve_markdown_file_name(
					(folder_data.children ?? []).map(c => c.name),
				)

				await create_entry(this, fm, folder_id, 'file', filename, {
					xattrs: position
						? [{ name: 'position', value: JSON.stringify(position) }]
						: [],
				})
			},
			async open_file(id: string) {
				try {
					await fm.open_file(id)
				} catch (error) {
					report_error(this, error)
				}
			},
			async import_external_files(paths: string[], position?: Position) {
				assert_can_write()
				if (this.type === 'cloud') {
					let files: File[]
					try {
						files = await read_paths_as_files(paths)
					} catch (error) {
						report_error(this, error)
						return
					}
					await this.import_files(this.opened_folder_id, files, position)
					return
				}
				const folder_id = this.opened_folder_id
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					report_error(this, new Error('Open a folder before importing files'))
					return
				}

				const existing_ids = (folder_data.children ?? []).map(c => c.id)
				const existing = new Set<string>((folder_data.children ?? []).map(c => c.name))
				const created_ids: string[] = []

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
					})
					created_ids.push(node.id)
				}

				if (created_ids.length === 0) return

				await persist_children_order(this, fm, folder_id, [
					...existing_ids,
					...created_ids,
				])

				const last_id = created_ids[created_ids.length - 1]
				if (last_id) this.select(last_id)
			},
			async import_files(folder_id: string, files: File[], position?: Position) {
				assert_can_write()
				const folder_data = this.resolve_folder_data(folder_id)
				if (!folder_data) {
					report_error(this, new Error('Open a folder before importing files'))
					return
				}

			const existing_ids = (folder_data.children ?? []).map(c => c.id)
			const existing = new Set<string>((folder_data.children ?? []).map(c => c.name))
			const created_ids: string[] = []

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
					})
					created_ids.push(node.id)
				}

				if (created_ids.length === 0) return

				await persist_children_order(this, fm, folder_id, [
					...existing_ids,
					...created_ids,
				])

				const last_id = created_ids[created_ids.length - 1]
				if (last_id) this.select(last_id)
			} finally {
				this.import_progress = null
			}
		},
			async remove(id: string) {
				assert_can_write()
				const owner_folder = find_entry_owner_folder(this.opened_folder, this.preview_folders, id)
				const owner_folder_id = owner_folder?.id

				try {
					await fm.remove(id)
				} catch (error) {
					report_error(this, error)
					return
				}
		const sep = path_separator(id)
		const is_inside_removed = (folder_id: string) =>
			folder_id === id || folder_id.startsWith(id + sep)
		invalidate_entry_content_caches(content_caches, id)
		apply_entry_removed(this, id)

		if (owner_folder_id) {
			await prune_folder_canvas_connections(this, owner_folder_id, [id])
		}

		const affected_tabs = this.tabs.filter(tab => is_inside_removed(tab.folder_id))
		if (affected_tabs.length > 0) {
			try {
				// Background tabs first: closing the active tab activates a
				// neighbor, which must not itself sit inside the removed subtree.
				for (const tab of affected_tabs) {
					if (this.tabs.length <= 1) break
					if (tab.id === this.active_tab_id) continue
					await this.close_tab(tab.id)
				}
				if (is_inside_removed(this.opened_folder_id)) {
					if (this.tabs.length > 1) {
						await this.close_tab(this.active_tab_id)
					} else {
						// Last remaining tab: fall back to the workspace root.
						await this.open_folder(this.id, { skipHistory: true })
					}
				}
		for (const folder_id of Object.keys(this.folders)) {
			if (is_inside_removed(folder_id)) {
				delete this.folders[folder_id]
			}
		}
		} catch (error) {
			report_error(this, error)
		}
	}

	// Ink cache/watches die with the folder regardless of open tabs.
	for (const folder_id of Object.keys(this.strokes_by_folder)) {
		if (is_inside_removed(folder_id)) {
			strokes_unwatch.get(folder_id)?.()
			strokes_unwatch.delete(folder_id)
			strokes_loaded.delete(folder_id)
			delete this.strokes_by_folder[folder_id]
		}
	}

	// Same for canvas edges.
	for (const folder_id of Object.keys(this.connections_by_folder)) {
		if (is_inside_removed(folder_id)) {
			connections_unwatch.get(folder_id)?.()
			connections_unwatch.delete(folder_id)
			connections_loaded.delete(folder_id)
			delete this.connections_by_folder[folder_id]
		}
	}
	},
			async rename(id: string, new_name: string) {
				assert_can_write()
				const name = new_name.trim()
				if (!name) return

				const tree_node = find_tree_node(this.tree, id)
				const folder_entry = find_child_entry(this.folders, id)
				const is_opened_folder = this.opened_folder_id === id

				if (
					tree_node?.name === name
					|| folder_entry?.name === name
					|| (is_opened_folder && this.opened_folder.name === name)
				) {
					return
				}

				if (!tree_node && !folder_entry && !is_opened_folder) return

				let result
				try {
					result = await fm.rename(id, name)
				} catch (error) {
					report_error(this, error)
					return
				}

		rekey_entry_content_caches(content_caches, id, result.id)
		apply_id_changed(this, id, result.id, result.name)
		await rename_folder_canvas_connections(this, id, result.id)
	},

			async move(
				id: string,
				target_folder_id: string,
				new_index: number,
				source_folder_id?: string,
				_source_index?: number,
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

					const persisted = await persist_children_order(
						this,
						fm,
						target_folder_id,
						list.map(n => n.id),
					)
					if (!persisted) {
						revert_to_folders()
					}
					return
				}

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

				return result.id
			},

			open(widget: FolderContainerWidgetChild) {
				widget.type === 'file' ? this.open_file(widget.id) : this.open_folder(widget.id)
			},
		})

		await start_watching(workspace, root_folder_id)
		return workspace
	} catch (error) {
		console.error(error)
		return null
	}
}

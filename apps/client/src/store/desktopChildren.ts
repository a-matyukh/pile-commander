import { reactive } from 'vue'
import type { FileManager } from '@pile-commander/file-manager'
import { createBrowserFileManager, createFileManager } from '@pile-commander/file-manager'
import type { Desktop } from '@/domain/Desktop'
import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { is_desktop } from '@/isDesktop'
import {
	CLOUD_DESKTOP_OFFLINE,
	cloud_failure_message,
	is_cloud_configured,
	require_supabase,
	supabase,
} from '@/services/cloud/client'
import { create_app_cloud_file_manager } from '@/services/cloud/cloudFileManager'
import {
	board_files_folder_exists,
	board_root_path,
	create_desktop_workspace,
	list_desktop_workspaces,
	remove_workspace,
	rename_workspace,
	set_workspace_xattr,
	type WorkspaceTile,
} from '@/services/cloud/desktopBoards'
import { createDesktopBoardFileManager } from '@/services/cloud/desktopBoardFileManager'
import { get_system_workspace_id } from '@/services/cloud/systemWorkspace'
import {
	browser_storage_available,
	ensure_browser_desktop_root,
	require_browser_storage,
} from '@/services/desktop/browserDesktopFolders'
import { ensure_desktop_folder } from '@/services/desktop/desktopFolders'
import { transfer_entries } from './helpers/crossStoreTransfer'
import { createWorkspaceStore } from './createWorkspaceStore'
import desktops, { type DesktopsStore } from './desktops'
import { workspace_registry } from './workspaceRegistry'
import { on_cloud_workspaces_synced, request_cloud_workspaces_refetch } from './workspaces_list'

type RegistryLike = Pick<
	typeof workspace_registry,
	'get_for_desktop' | 'register_desktop' | 'dispose_for_desktop'
>

export
type DesktopChildrenDeps = {
	/**
	 * Resolves the desktop root (workspace root id): mkdir -p for default
	 * folders, existence check for adopted ones (throws when missing), the
	 * IndexedDB root for web desktops.
	 */
	ensure_folder: (desktop: Desktop) => Promise<string>
	open_store: (item: WorkspacesListItem) => Promise<WorkspaceStore>
	/** local children need the Tauri fs or (web) a usable IndexedDB */
	is_available: () => boolean
	/**
	 * WorkspaceListItem type of the board root and of folders opened as
	 * windows: 'local' under Tauri, 'browser' on the web.
	 */
	child_item_type: () => 'local' | 'browser'
	/** Surface a load failure (e.g. a missing adopted folder) to the user */
	on_error?: (message: string) => void
}

/** Cloud board IO; every method talks to Supabase (injected for tests). */
export
type CloudDesktopChildrenDeps = {
	/** cloud children need an authenticated session (web after login too) */
	is_available: () => Promise<boolean>
	system_workspace_id: () => Promise<string>
	/** Cheap existence probe for the desktop's loose-files folder (no 400s) */
	board_files_folder_exists: (system_workspace_id: string, desktop_id: string) => Promise<boolean>
	list_tiles: (desktop_id: string) => Promise<WorkspaceTile[]>
	/** Creates a workspace pinned to the desktop; resolves to the workspace id */
	create_tile: (desktop_id: string, name: string) => Promise<string>
	rename_tile: (workspace_id: string, name: string) => Promise<void>
	remove_tile: (workspace_id: string) => Promise<void>
	set_tile_xattr: (workspace_id: string, name: string, value: string) => Promise<void>
	/** FileManager of the hidden system workspace (board files) */
	system_fm: (system_workspace_id: string) => FileManager
	/** FileManager of a child workspace (tile previews / content reads) */
	workspace_fm: (workspace_id: string) => FileManager
	/** sidebar list follows board-originated workspace mutations */
	sync_sidebar: () => void
}

export
type DesktopChildrenStore = {
	/**
	 * Live workspace store of the desktop's children folder, opened lazily.
	 * Concurrent calls share one open; null when children are unavailable.
	 */
	get_store(desktop: Desktop): Promise<WorkspaceStore | null>
	/**
	 * Sidebar-driven refresh: re-reads workspace tiles and reloads the board
	 * root cache of every open cloud board (fired on cloud workspaces syncs).
	 */
	refresh_cloud_boards(): Promise<void>
	/**
	 * Resolves a board node id to its workspace tile (tile roots only;
	 * deeper paths inside a tile workspace and plain entries return null).
	 * Drives the tile context menu choice on cloud desktop boards.
	 */
	workspace_tile_at(node_id: string): WorkspaceTile | null
	/** True while `get_store` is opening the desktop's children folder. */
	is_loading(desktop_id: string): boolean
}

/** Last path segment handles both separators (Windows paths keep `\`). */
function folder_name_from_id(folder_id: string): string {
	return folder_id.split(/[/\\]/).filter(Boolean).pop() ?? folder_id
}

/**
 * macOS desktop metaphor: a folder child opens as its own window (a
 * workspace window) instead of navigating the desktop board — the surface
 * has no chrome to go back. Reopening focuses the existing window on this desktop.
 */
function open_workspace_as_window(desktops_store: DesktopsStore, item: WorkspacesListItem): void {
	desktops_store.open_workspace_window(item)
}

export
function createDesktopChildrenStore(
	deps: DesktopChildrenDeps,
	registry: RegistryLike,
	desktops_store: DesktopsStore,
	cloud_deps?: CloudDesktopChildrenDeps,
): DesktopChildrenStore {
	const inflight = new Map<string, Promise<WorkspaceStore | null>>()
	const loading_desktop_ids = reactive(new Set<string>())
	// cloud board state: tiles per loaded desktop + a FileManager per child
	// workspace (stateless-ish: only the board root is watched, on the system fm).
	// Reactive: board widgets pick their context menu by workspace_tile_at()
	const tiles_by_desktop = reactive(new Map<string, WorkspaceTile[]>())
	const workspace_fms = new Map<string, FileManager>()

	function cached_workspace_fm(workspace_id: string): FileManager {
		let fm = workspace_fms.get(workspace_id)
		if (!fm) {
			if (!cloud_deps) throw new Error('cloud desktop children are not available')
			fm = cloud_deps.workspace_fm(workspace_id)
			workspace_fms.set(workspace_id, fm)
		}
		return fm
	}

	function tile_for_path(desktop_id: string, folder_id: string): WorkspaceTile | null {
		const root = board_root_path(desktop_id)
		if (!folder_id.startsWith(`${root}/`)) return null
		const segment = folder_id.slice(root.length + 1).split('/')[0]
		return (tiles_by_desktop.get(desktop_id) ?? [])
			.find(tile => tile.workspace_id === segment) ?? null
	}

	function update_tile(desktop_id: string, workspace_id: string, patch: Partial<WorkspaceTile>): void {
		tiles_by_desktop.set(
			desktop_id,
			(tiles_by_desktop.get(desktop_id) ?? [])
				.map(tile => tile.workspace_id === workspace_id ? { ...tile, ...patch } : tile),
		)
	}

	function tile_xattrs(desktop_id: string, workspace_id: string): Record<string, string> {
		return (tiles_by_desktop.get(desktop_id) ?? [])
			.find(tile => tile.workspace_id === workspace_id)?.xattrs ?? {}
	}

	async function load_local(desktop: Desktop): Promise<WorkspaceStore | null> {
		if (!deps.is_available()) return null
		let path: string
		try {
			path = await deps.ensure_folder(desktop)
		} catch (error) {
			// An adopted folder that went missing outside the app must not be
			// recreated silently — the board renders as children-unavailable
			// (same as web) until the folder comes back.
			deps.on_error?.(error instanceof Error ? error.message : String(error))
			return null
		}
		const workspace = await deps.open_store({
			id: path,
			type: deps.child_item_type(),
			name: desktop.name,
		})
		// Intercept every folder-open gesture on the desktop board (preview
		// title dblclick, widget menu "Open" / "Open in new tab"): they all
		// funnel through these two store methods.
		const open_as_window = async (folder_id: string) => {
			open_workspace_as_window(desktops_store, {
				type: deps.child_item_type(),
				id: folder_id,
				name: folder_name_from_id(folder_id),
			})
		}
		workspace.open_folder = open_as_window
		workspace.open_folder_in_new_tab = open_as_window
		return workspace
	}

	async function load_cloud(desktop: Desktop): Promise<WorkspaceStore | null> {
		if (!cloud_deps || !(await cloud_deps.is_available())) return null
		try {
			return await open_cloud_board(desktop)
		} catch (error) {
			deps.on_error?.(cloud_failure_message(error, CLOUD_DESKTOP_OFFLINE))
			return null
		}
	}

	async function open_cloud_board(desktop: Desktop): Promise<WorkspaceStore | null> {
		if (!cloud_deps) return null
		const system_id = await cloud_deps.system_workspace_id()
		const inner = cloud_deps.system_fm(system_id)
		const root = board_root_path(desktop.id)
		// the files folder is created lazily on first open (probed cheaply:
		// folder_read on a missing path 400s and the browser always logs it)
		if (!await cloud_deps.board_files_folder_exists(system_id, desktop.id)) {
			await inner.create_folder('/', root.slice(1))
		}
		tiles_by_desktop.set(desktop.id, await cloud_deps.list_tiles(desktop.id))

		const fm = createDesktopBoardFileManager(inner, root, {
			tiles: () => tiles_by_desktop.get(desktop.id) ?? [],
			workspace_fm: cached_workspace_fm,
			create_workspace: async (name) => {
				const workspace_id = await cloud_deps.create_tile(desktop.id, name)
				// the tile must be known right away: the store writes position/size
				// xattrs onto the created child id in the same breath
				tiles_by_desktop.set(desktop.id, [
					...(tiles_by_desktop.get(desktop.id) ?? []),
					{ workspace_id, name, xattrs: {} },
				])
				cloud_deps.sync_sidebar()
				return { workspace_id }
			},
			rename_workspace: async (workspace_id, name) => {
				await cloud_deps.rename_tile(workspace_id, name)
				update_tile(desktop.id, workspace_id, { name })
				cloud_deps.sync_sidebar()
			},
			remove_workspace: async (workspace_id) => {
				await cloud_deps.remove_tile(workspace_id)
				tiles_by_desktop.set(
					desktop.id,
					(tiles_by_desktop.get(desktop.id) ?? [])
						.filter(tile => tile.workspace_id !== workspace_id),
				)
				workspace_fms.delete(workspace_id)
				cloud_deps.sync_sidebar()
			},
			set_workspace_xattr: async (workspace_id, name, value) => {
				await cloud_deps.set_tile_xattr(workspace_id, name, value)
				update_tile(desktop.id, workspace_id, {
					xattrs: { ...tile_xattrs(desktop.id, workspace_id), [name]: value },
				})
			},
		})

		const workspace = await createWorkspaceStore(
			{ id: system_id, type: 'cloud', name: desktop.name },
			fm,
			{ root_folder_id: root },
		)
		if (!workspace) return null

		const open_tile = async (folder_id: string) => {
			const tile = tile_for_path(desktop.id, folder_id)
			if (tile) {
				open_workspace_as_window(desktops_store, {
					type: 'cloud',
					id: tile.workspace_id,
					name: tile.name,
				})
				return
			}
			// a plain entry-folder inside the system workspace (the UI never
			// creates these): the surface has no chrome to go back, so it
			// opens in place like a regular folder
			await workspace.navigate_open_folder(folder_id)
		}
		workspace.open_folder = open_tile
		workspace.open_folder_in_new_tab = open_tile

		// "Uncombine" moves children out and then removes the folder — for a
		// workspace tile that would delete the whole workspace
		const uncombine_folder = workspace.uncombine_folder.bind(workspace)
		workspace.uncombine_folder = async (folder_id: string) => {
			if (tile_for_path(desktop.id, folder_id)) {
				workspace.last_error = 'Workspace tiles cannot be uncombined'
				return
			}
			await uncombine_folder(folder_id)
		}

		// create_entry seeds an empty cache for new folders; for a workspace
		// tile let the first preview fetch read the real workspace instead
		const create_folder = workspace.create_folder.bind(workspace)
		workspace.create_folder = async (folder_id, position, options) => {
			const new_id = await create_folder(folder_id, position, options)
			if (new_id && tile_for_path(desktop.id, new_id)) {
				delete workspace.folders[new_id]
				workspace.tree_loaded_folder_ids.delete(new_id)
			}
			return new_id
		}

		// Dropping a board entry onto a workspace tile is a cross-workspace
		// move the cloud RPC forbids. Intercept it here (the generic store
		// stays unaware of tiles) and run a client-side transfer instead —
		// the board FM routes every individual read/write into the right
		// workspace. Tile-into-tile drags still fall through to the FM error.
		const base_move = workspace.move.bind(workspace)
		workspace.move = async (id, target_folder_id, new_index, source_folder_id, source_index) => {
			const cross_workspace =
				tile_for_path(desktop.id, target_folder_id) !== null
				&& tile_for_path(desktop.id, id) === null
			if (!cross_workspace) {
				return base_move(id, target_folder_id, new_index, source_folder_id, source_index)
			}
			const created = await transfer_entries({
				source_store: workspace,
				target_store: workspace,
				entry_ids: [id],
				target_folder_id,
				mode: 'move',
				// one store, many workspaces: the direct fm.move/copy shortcut
				// would hit the backend's cross-workspace refusal the wrap
				// exists to bypass
				force_generic: true,
			})
			return created[0]
		}

		return workspace
	}

	async function load(desktop: Desktop): Promise<WorkspaceStore | null> {
		const workspace = desktop.backend === 'cloud'
			? await load_cloud(desktop)
			: await load_local(desktop)
		if (!workspace) return null
		// the desktop may have been removed (or the session lost) mid-load
		if (!desktops_store.desktops.some(d => d.id === desktop.id)) {
			workspace.dispose()
			return null
		}
		registry.register_desktop(desktop.id, workspace)
		return workspace
	}

	// a removed desktop never keeps its children store alive
	desktops_store.set_on_desktop_removed((desktop_id) => {
		registry.dispose_for_desktop(desktop_id)
		const tiles = tiles_by_desktop.get(desktop_id)
		if (tiles) {
			for (const tile of tiles) workspace_fms.delete(tile.workspace_id)
			tiles_by_desktop.delete(desktop_id)
		}
	})

	return {
		get_store(desktop) {
			const existing = registry.get_for_desktop(desktop.id)
			if (existing) return Promise.resolve(existing)
			let pending = inflight.get(desktop.id)
			if (!pending) {
				loading_desktop_ids.add(desktop.id)
				pending = load(desktop).finally(() => {
					inflight.delete(desktop.id)
					loading_desktop_ids.delete(desktop.id)
				})
				inflight.set(desktop.id, pending)
			}
			return pending
		},

		is_loading(desktop_id: string) {
			return loading_desktop_ids.has(desktop_id)
		},

		async refresh_cloud_boards() {
			if (!cloud_deps) return
			for (const desktop_id of [...tiles_by_desktop.keys()]) {
				try {
					tiles_by_desktop.set(desktop_id, await cloud_deps.list_tiles(desktop_id))
					const store = registry.get_for_desktop(desktop_id)
					if (store) {
						await store.reload_folder_cache(board_root_path(desktop_id))
					}
				} catch {
					// best-effort: the next watch event / board reopen heals it
				}
			}
		},

		workspace_tile_at(node_id: string) {
			for (const [desktop_id, tiles] of tiles_by_desktop) {
				const root = board_root_path(desktop_id)
				if (!node_id.startsWith(`${root}/`)) continue
				const segment = node_id.slice(root.length + 1)
				if (segment.includes('/')) continue
				const tile = tiles.find(t => t.workspace_id === segment)
				if (tile) return tile
			}
			return null
		},
	}
}

const cloud_children_deps: CloudDesktopChildrenDeps = {
	is_available: async () => {
		if (!is_cloud_configured || !supabase) return false
		const { data } = await supabase.auth.getSession()
		return Boolean(data.session)
	},
	system_workspace_id: () => get_system_workspace_id(),
	board_files_folder_exists: (system_workspace_id, desktop_id) =>
		board_files_folder_exists(require_supabase(), system_workspace_id, desktop_id),
	list_tiles: (desktop_id) => list_desktop_workspaces(require_supabase(), desktop_id),
	create_tile: (desktop_id, name) => create_desktop_workspace(require_supabase(), desktop_id, name),
	rename_tile: (workspace_id, name) => rename_workspace(require_supabase(), workspace_id, name),
	remove_tile: (workspace_id) => remove_workspace(require_supabase(), workspace_id),
	set_tile_xattr: (workspace_id, name, value) =>
		set_workspace_xattr(require_supabase(), workspace_id, name, value),
	system_fm: (workspace_id) => create_app_cloud_file_manager(workspace_id),
	workspace_fm: (workspace_id) => create_app_cloud_file_manager(workspace_id),
	sync_sidebar: () => request_cloud_workspaces_refetch(),
}

const desktop_children = createDesktopChildrenStore(
	{
		ensure_folder: async (desktop) => {
			if (is_desktop) return ensure_desktop_folder(desktop)
			// web: children live in IndexedDB; Desktop.path can't exist
			// (the custom-location picker is Tauri-only)
			return ensure_browser_desktop_root(desktop.id)
		},
		// desktop children delete to the OS trash on Tauri — these are the
		// user's own files sitting on their desktop; web storage has no
		// trash, removal there is permanent
		open_store: async (item) => {
			const fm = item.type === 'browser'
				? createBrowserFileManager(require_browser_storage())
				: createFileManager('local', { remove_to_trash: true })
			const workspace = await createWorkspaceStore(item, fm)
			if (!workspace) throw new Error(`Failed to open desktop folder “${item.name}”`)
			return workspace
		},
		is_available: () => is_desktop || browser_storage_available(),
		child_item_type: () => is_desktop ? 'local' : 'browser',
		on_error: (message) => {
			// lazy: the app store pulls the window manager / pack services,
			// which vitest unit tests of this module must not load
			void import('./index').then(({ default: app_store }) => {
				app_store.last_error = message
			})
		},
	},
	workspace_registry,
	desktops,
	cloud_children_deps,
)

// board tiles follow sidebar renames/removals of the child workspaces
on_cloud_workspaces_synced(() => {
	void desktop_children.refresh_cloud_boards()
})

export default desktop_children

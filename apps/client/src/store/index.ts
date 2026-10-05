import { reactive, ref } from 'vue'
import { basename } from '@tauri-apps/api/path'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import type { ImportProgress, LoadWorkspaceOptions, Store, WorkspaceStore } from '../domain/Store'
import { focused_window } from '@/domain/Desktop'
import { is_desktop } from '@/isDesktop'
import { createFileManager, download_blob } from '@pile-commander/file-manager'
import { create_window_manager } from '../services/window/WindowManager'
import {
	build_cloud_workspace_pile,
	export_cloud_workspace_to_pile,
	export_workspace_to_pile,
	import_workspace_from_pile,
	pile_root_name,
} from '../services/workspace/pack'
import {
	add_to_bookmarks,
	add_to_last_opened,
	bookmarks,
	last_opened,
	remove_from_bookmarks,
} from './workspaces_list'
import { createWorkspaceStore } from './createWorkspaceStore'
import { report_error } from './helpers/reportError'
import { normalize_workspace_id } from '../services/workspace/paths'
import { open_workspace_store } from './helpers/openWorkspaceStore'
import desktops from './desktops'
import { workspace_registry } from './workspaceRegistry'
import { is_workspace_available } from './isWorkspaceAvailable'
import cloud from './cloud'
import { reset_address_to_root, window_content_from_fullscreen } from '@/services/publicRoute'
import { hub_open } from '@/ui/hub/hubUi'
import { desktops_enabled } from './experiments'

export { createWorkspaceStore }

const wm = create_window_manager()

/** Workspace of the fullscreen (single-workspace) render mode. */
const fullscreen_workspace = ref<WorkspaceStore | null>(null)

const store: Store = {
	is_workspace_loading: false,
	last_error: null,
	clear_error() {
		this.last_error = null
	},

	get bookmarks() {
		const ctx = { is_desktop, cloud_ids: new Set(cloud.workspaces.map(ws => ws.id)) }
		return bookmarks.value.filter(ws => is_workspace_available(ws, ctx))
	},
	get last_opened() {
		const bookmark_ids = new Set(bookmarks.value.map(ws => ws.id))
		const ctx = { is_desktop, cloud_ids: new Set(cloud.workspaces.map(ws => ws.id)) }
		return last_opened.value.filter(ws => !bookmark_ids.has(ws.id) && is_workspace_available(ws, ctx))
	},
	add_to_bookmarks,
	remove_from_bookmarks,

	async open_local_workspace(path?: string, opts?: LoadWorkspaceOptions) {
		if (path) {
			const name = await basename(path)
			await this.load_workspace({ type: 'local', id: path, name }, opts)
			return
		}
		const picked = await wm.pick_folder()
		if (!picked) return
		await this.load_workspace({ type: 'local', id: picked.folder_id, name: picked.name }, opts)
	},
	async open_demo_workspace(opts?: LoadWorkspaceOptions) {
		await this.load_workspace({ type: 'demo', id: '/demo', name: 'Demo' }, opts)
	},
	async export_current_workspace() {
		const ws = this.workspace
		if (!ws || (ws.type !== 'local' && ws.type !== 'cloud') || !is_desktop) {
			report_error(this, new Error('Open a local or cloud workspace in the desktop app to export'))
			return
		}
		this.last_error = null
		try {
			const zip_path = await wm.save_pile_file(`${ws.name}.pile`)
			if (!zip_path) return
			if (ws.type === 'cloud') {
				// the whole workspace downloads first: the window's import overlay shows it
				try {
					await export_cloud_workspace_to_pile(ws.file_manager, ws.name, zip_path, (progress) => {
						ws.import_progress = progress
					})
				} finally {
					ws.import_progress = null
				}
				return
			}
			const fm = createFileManager('local')
			await export_workspace_to_pile(fm, ws.id, zip_path)
		} catch (error) {
			report_error(this, error)
		}
	},
	async download_public_workspace(ws) {
		if (ws.type !== 'cloud') return
		this.last_error = null
		// the whole workspace downloads first: the window's import overlay shows it
		const on_progress = (progress: ImportProgress) => {
			ws.import_progress = progress
		}
		try {
			if (is_desktop) {
				const zip_path = await wm.save_pile_file(`${ws.name}.pile`)
				if (!zip_path) return
				await export_cloud_workspace_to_pile(ws.file_manager, ws.name, zip_path, on_progress)
				return
			}
			const blob = await build_cloud_workspace_pile(ws.file_manager, ws.name, on_progress)
			download_blob(blob, `${pile_root_name(ws.name)}.pile`)
		} catch (error) {
			report_error(this, error)
		} finally {
			ws.import_progress = null
		}
	},
	async import_workspace_pack(pile_path?: string, opts?: LoadWorkspaceOptions) {
		this.last_error = null
		try {
			const zip_path = pile_path ?? await wm.pick_pile_file()
			if (!zip_path) return
			const dest = await wm.pick_folder({
				title: 'Choose a folder to import the workspace into',
			})
			if (!dest) return
			const { root, name } = await import_workspace_from_pile(zip_path, dest.folder_id)
			await this.load_workspace({ type: 'local', id: root, name }, opts)
		} catch (error) {
			report_error(this, error)
		}
	},
	async load_workspace(ws: WorkspacesListItem, opts?: LoadWorkspaceOptions) {
		const item: WorkspacesListItem = ws.type === 'local'
			? { ...ws, id: normalize_workspace_id(ws.id) }
			: ws
		// Desktops mode: Start / drop → new window; header list → replace in place.
		// Window.vue loads the registry store when content changes.
		if (desktops.mode === 'desktops' && !opts?.public_readonly) {
			if (opts?.replace_window_id) {
				desktops.replace_window_workspace(opts.replace_window_id, item)
				return
			}
			desktops.open_workspace_window(item)
			return
		}
		// re-entrant calls (double click on a workspace button) would dispose
		// and recreate the store mid-flight — duplicate realtime subscription
		if (this.is_workspace_loading) return
		this.is_workspace_loading = true
		this.last_error = null
		try {
			fullscreen_workspace.value?.dispose()
			fullscreen_workspace.value = null

			const workspace = await open_workspace_store(item, opts)
			fullscreen_workspace.value = workspace
			await workspace.prefetch_preview_folders(workspace.opened_folder.children)
			add_to_last_opened(item)
		} catch (error) {
			report_error(this, error)
			fullscreen_workspace.value = null
		} finally {
			this.is_workspace_loading = false
		}
	},

	get workspace() {
		if (desktops.mode === 'desktops') {
			return workspace_registry.focused_workspace()
		}
		return fullscreen_workspace.value
	},

	close_workspace() {
		this.workspace?.dispose()
		if (desktops.mode === 'desktops') {
			const desktop = desktops.selected_desktop
			const focused = desktop
				? focused_window(desktop, w => w.content.kind === 'workspace')
				: null
			if (focused) {
				workspace_registry.dispose_for_window(focused.id)
				desktops.close_window(focused.id)
			}
			return
		}
		fullscreen_workspace.value = null
	},

	eject_workspace(window_id: string) {
		const window = desktops.desktops
			.flatMap(desktop => desktop.windows)
			.find(w => w.id === window_id)
		workspace_registry.dispose_for_window(window_id)
		if (window?.content.kind === 'slug') {
			cloud.publication_view = null
			cloud.public_not_found = null
		}
		desktops.set_window_content(window_id, { kind: 'empty' })
	},

	/**
	 * fullscreen app mode → desktops mode: public views become the matching
	 * window (slug / profile / hub); a regular workspace keeps its live store.
	 * The address bar resets to `/`.
	 */
	enter_desktops_mode() {
		if (!desktops_enabled.value) return
		const workspace = fullscreen_workspace.value
		const content = window_content_from_fullscreen({
			publication: cloud.publication_view
				? { username: cloud.publication_view.username, slug: cloud.publication_view.slug }
				: null,
			public_not_found: cloud.public_not_found,
			profile_username: cloud.profile_view?.profile.username ?? null,
			profile_not_found: cloud.profile_not_found,
			hub_open: hub_open.value,
			pathname: window.location.pathname,
			workspace: workspace
				? { id: workspace.uid, type: workspace.type, name: workspace.name }
				: null,
		})
		desktops.enter_desktops()
		reset_address_to_root()
		if (!content) {
			workspace?.dispose()
			fullscreen_workspace.value = null
			return
		}
		const opened = desktops.open_window(content)
		if (workspace && (content.kind === 'workspace' || content.kind === 'slug')) {
			workspace_registry.adopt(opened.id, workspace)
		} else {
			workspace?.dispose()
		}
		fullscreen_workspace.value = null
	},

	exit_desktops_mode() {
		if (desktops.mode !== 'desktops') return
		const desktop = desktops.selected_desktop
		const focused = desktop
			? focused_window(desktop, w => w.content.kind === 'workspace')
			: null
		// the focused workspace stays open, now as the fullscreen app
		const kept = focused ? workspace_registry.release(focused.id) : null
		// the other windows reload their stores when desktops mode comes back
		for (const d of desktops.desktops) {
			for (const w of d.windows) workspace_registry.dispose_for_window(w.id)
		}
		fullscreen_workspace.value?.dispose()
		fullscreen_workspace.value = kept
		desktops.exit_to_fullscreen()
	},
}

export default reactive(store)

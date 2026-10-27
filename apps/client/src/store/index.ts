import { reactive, ref } from 'vue'
import { basename } from '@tauri-apps/api/path'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import type { ImportProgress, LoadWorkspaceOptions, Store, WorkspaceStore } from '../domain/Store'
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
import { is_workspace_available } from './isWorkspaceAvailable'
import cloud from './cloud'

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
		return fullscreen_workspace.value
	},

	close_workspace() {
		this.workspace?.dispose()
		fullscreen_workspace.value = null
	},
}

/** Points the shell at a store Drive already holds, without disposing it or any other. */
export function adopt_workspace(workspace: WorkspaceStore | null) {
	fullscreen_workspace.value = workspace
}

export default reactive(store)

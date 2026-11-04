import { reactive, ref } from 'vue'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import type { LoadWorkspaceOptions, Store, WorkspaceStore } from '../domain/Store'
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
import { createWorkspaceStore } from './createWorkspaceStore'
import { pile_archive_name, run_pile_export } from './explorer/exportPile'
import { report_error } from './helpers/reportError'
import { normalize_workspace_id } from '../services/workspace/paths'
import { open_workspace_store } from './helpers/openWorkspaceStore'

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

	async export_current_workspace(ws = this.workspace ?? undefined) {
		if (!ws || (ws.type !== 'local' && ws.type !== 'cloud')) {
			report_error(this, new Error('Open a local or cloud workspace to export'))
			return
		}
		if (ws.type === 'cloud') {
			await this.download_public_workspace(ws)
			return
		}
		if (!is_desktop) {
			report_error(this, new Error('Open a local workspace in the desktop app to export'))
			return
		}
		this.last_error = null
		try {
			const zip_path = await wm.save_pile_file(`${ws.name}.pile`)
			if (!zip_path) return
			await run_pile_export(ws.name, async (notify) => {
				notify.packing()
				const fm = createFileManager('local')
				await export_workspace_to_pile(fm, ws.id, zip_path)
				return { file_name: pile_archive_name(zip_path, `${ws.name}.pile`), path: zip_path }
			})
		} catch (error) {
			report_error(this, error)
		}
	},
	async download_public_workspace(ws) {
		if (ws.type !== 'cloud') return
		this.last_error = null
		try {
			if (is_desktop) {
				const zip_path = await wm.save_pile_file(`${ws.name}.pile`)
				if (!zip_path) return
				await run_pile_export(ws.name, async (notify) => {
					await export_cloud_workspace_to_pile(
						ws.file_manager,
						ws.name,
						zip_path,
						(progress) => notify.downloading(progress.file_index, progress.total_files),
						notify.packing,
					)
					return { file_name: pile_archive_name(zip_path, `${ws.name}.pile`), path: zip_path }
				})
				return
			}
			await run_pile_export(ws.name, async (notify) => {
				const blob = await build_cloud_workspace_pile(
					ws.file_manager,
					ws.name,
					(progress) => notify.downloading(progress.file_index, progress.total_files),
					notify.packing,
				)
				const file_name = `${pile_root_name(ws.name)}.pile`
				download_blob(blob, file_name)
				return { file_name, path: null }
			})
		} catch (error) {
			report_error(this, error)
		}
	},
	async unpack_workspace_pack(pile_path?: string) {
		this.last_error = null
		try {
			const zip_path = pile_path ?? await wm.pick_pile_file()
			if (!zip_path) return null
			const dest = await wm.pick_folder({
				title: 'Choose a folder to import the workspace into',
			})
			if (!dest) return null
			return await import_workspace_from_pile(zip_path, dest.folder_id)
		} catch (error) {
			report_error(this, error)
			return null
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

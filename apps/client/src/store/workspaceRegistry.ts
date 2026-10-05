import { reactive } from 'vue'
import { focused_window, window_content_matches_item } from '@/domain/Desktop'
import type { LoadWorkspaceOptions, WorkspaceStore } from '@/domain/Store'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { normalize_workspace_id } from '@/services/workspace/paths'
import desktops from './desktops'
import { open_workspace_store } from './helpers/openWorkspaceStore'
import { add_to_last_opened } from './workspaces_list'

const stores = reactive(new Map<string, WorkspaceStore>())
const loading = reactive(new Set<string>())
/** In-flight load_for_window promises, so a second caller waits instead of
 *  treating an empty registry as "not found" (Window.vue would flash the
 *  error, then fullscreen remount would finally show the store). */
const inflight = new Map<string, Promise<void>>()

/** Desktop children stores share the map with window stores; the prefix
 * keeps them apart from window ids (nanoid never contains ':'). */
const desktop_key = (desktop_id: string) => `desktop:${desktop_id}`

function window_still_wants(window_id: string, item: WorkspacesListItem): boolean {
	for (const desktop of desktops.desktops) {
		const window = desktop.windows.find(w => w.id === window_id)
		if (!window) continue
		return window_content_matches_item(window.content, item)
	}
	return false
}

/**
 * Live workspace stores of open windows, keyed by window id. Each window
 * owns its store instance; closing the window disposes it.
 */
export const workspace_registry = {
	get(window_id: string): WorkspaceStore | null {
		return stores.get(window_id) ?? null
	},

	is_loading(window_id: string): boolean {
		return loading.has(window_id)
	},

	/**
	 * Workspace shown as "current" for global (non-injected) consumers in
	 * desktops mode: the top-most visible workspace window of the selected
	 * desktop. Null while the desktop board holds the keyboard focus
	 * (desktops.focus_board) — then global shortcuts belong to the board.
	 */
	focused_workspace(): WorkspaceStore | null {
		const desktop = desktops.selected_desktop
		if (!desktop || desktops.is_board_focused(desktop.id)) return null
		const window = focused_window(
			desktop,
			w => w.content.kind === 'workspace' || w.content.kind === 'slug',
		)
		return window ? (stores.get(window.id) ?? null) : null
	},

	async load_for_window(
		window_id: string,
		item: WorkspacesListItem,
		opts?: LoadWorkspaceOptions,
	): Promise<void> {
		const pending = inflight.get(window_id)
		if (pending) {
			await pending
			const current = this.get(window_id)
			if (current && current.type === item.type && current.uid === item.id) return
		}
		const run = (async () => {
			loading.add(window_id)
			try {
				const normalized = item.type === 'local'
					? { ...item, id: normalize_workspace_id(item.id) }
					: item
				const workspace = await open_workspace_store(normalized, opts)
				if (!window_still_wants(window_id, normalized)) {
					workspace.dispose()
					return
				}
				this.dispose_for_window(window_id)
				stores.set(window_id, workspace)
				await workspace.prefetch_preview_folders(workspace.opened_folder.children)
				add_to_last_opened(normalized)
			} finally {
				loading.delete(window_id)
			}
		})()
		inflight.set(window_id, run)
		try {
			await run
		} finally {
			if (inflight.get(window_id) === run) inflight.delete(window_id)
		}
	},

	/** Hands an already-live store over to a window (fullscreen → desktops transition). */
	adopt(window_id: string, workspace: WorkspaceStore): void {
		this.dispose_for_window(window_id)
		stores.set(window_id, workspace)
	},

	/**
	 * Takes a window's live store out of the registry without disposing it
	 * (desktops → fullscreen transition: the caller now owns it).
	 */
	release(window_id: string): WorkspaceStore | null {
		const workspace = stores.get(window_id) ?? null
		stores.delete(window_id)
		return workspace
	},

	dispose_for_window(window_id: string): void {
		const workspace = stores.get(window_id)
		if (workspace) {
			workspace.dispose()
			stores.delete(window_id)
		}
	},

	get_for_desktop(desktop_id: string): WorkspaceStore | null {
		return stores.get(desktop_key(desktop_id)) ?? null
	},

	/** Hands an already-live desktop children store over to the registry. */
	register_desktop(desktop_id: string, workspace: WorkspaceStore): void {
		this.dispose_for_desktop(desktop_id)
		stores.set(desktop_key(desktop_id), workspace)
	},

	dispose_for_desktop(desktop_id: string): void {
		const key = desktop_key(desktop_id)
		const workspace = stores.get(key)
		if (workspace) {
			workspace.dispose()
			stores.delete(key)
		}
	},

	dispose_all(): void {
		for (const workspace of stores.values()) workspace.dispose()
		stores.clear()
	},
}

desktops.set_on_window_closed((window_id) => {
	workspace_registry.dispose_for_window(window_id)
	loading.delete(window_id)
})

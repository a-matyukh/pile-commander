import { reactive, ref, watch, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import type { Position, Size } from '@/domain/Widget'
import {
	normalize_desktop,
	type AppWindow,
	type CloudDesktopPatch,
	type Desktop,
	type DesktopBackend,
	type DesktopsMode,
	type DesktopsState,
	type WindowContent,
} from '@/domain/Desktop'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import {
	delete_cloud_desktop,
	fetch_cloud_desktops,
	insert_cloud_desktop,
	update_cloud_desktop,
} from '@/services/cloud/desktops'
import { require_supabase } from '@/services/cloud/client'

export
type DesktopsCloudDeps = {
	/** Server truth, fills the cloud group (login / manual refresh) */
	fetch_all(): Promise<Desktop[]>
	insert(desktop: Desktop, position: number): Promise<void>
	update(id: string, patch: CloudDesktopPatch): Promise<void>
	remove(id: string): Promise<void>
}

export
type DesktopsStore = {
	readonly mode: DesktopsMode
	/** local group first, then cloud group (groups never interleave) */
	readonly desktops: Desktop[]
	readonly selected_desktop_id: string
	readonly selected_desktop: Desktop | null
	/** Message of the last failed cloud operation; UI may show and reset it */
	readonly last_error: string | null

	add_desktop(name?: string, backend?: DesktopBackend, path?: string): Desktop
	select_desktop(id: string): void
	rename_desktop(id: string, name: string): void
	update_desktop_xattrs(id: string, patch: Partial<Desktop['xattrs']>): void
	reorder_desktop(from: number, to: number): void
	/** false = последний десктоп, удалять нельзя (считаются обе группы) */
	remove_desktop(id: string): boolean
	/** Replaces the cloud group wholesale (server fetch on login, [] on logout) */
	set_cloud_desktops(desktops: Desktop[]): void
	/** Fetches cloud desktops from the server into the cloud group */
	sync_cloud_desktops(): Promise<void>
	/**
	 * Logout: closes cloud windows (registry disposes their stores via
	 * on_window_closed), disposes children stores (on_desktop_removed),
	 * cancels pending syncs, clears the group and falls the selection back
	 */
	teardown_cloud_desktops(): void
	clear_error(): void

	/** Создаёт floating-окно на выбранном десктопе и поднимает его наверх */
	open_window(content: WindowContent): AppWindow
	/**
	 * Address-bar / Hub cards: if a window is already fullscreen, replace its
	 * content and stay fullscreen. Otherwise open a new floating window.
	 */
	open_or_replace_fullscreen(content: WindowContent): AppWindow
	/**
	 * Opens a workspace as a window on the selected desktop, or focuses an
	 * existing one for the same item on that desktop. Other desktops may
	 * keep their own window of the same workspace.
	 */
	open_workspace_window(item: WorkspacesListItem): AppWindow
	/**
	 * Loads a workspace into an existing window, or focuses another window
	 * on the same desktop that already shows it (one window per workspace
	 * per desktop). Does not switch desktops.
	 */
	replace_window_workspace(window_id: string, item: WorkspacesListItem): AppWindow | null
	/** Replaces the window's content (e.g. switch workspace in place from the header). */
	set_window_content(window_id: string, content: WindowContent): void
	close_window(window_id: string): void
	hide_window(window_id: string): void
	/** Возврат из minimized в floating + bring-to-front (клик в таскбаре) */
	restore_window(window_id: string): void
	toggle_fullscreen(window_id: string): void
	/** bring-to-front: окно становится последним в массиве (верх z-order) */
	focus_window(window_id: string): void
	/**
	 * Transient (not persisted/synced): the desktop board itself holds keyboard
	 * focus — set by clicking the board surface, cleared by focusing/opening
	 * any window. While board-focused, no window answers global shortcuts, so
	 * e.g. Cmd+V pastes onto the desktop instead of into a window.
	 */
	is_board_focused(desktop_id: string): boolean
	focus_board(desktop_id: string): void
	update_window_geometry(window_id: string, geometry: { position?: Position; size?: Size }): void
	reorder_windows(from: number, to: number): void

	enter_desktops(): void
	exit_to_fullscreen(): void
	/** Internal: lets the workspace registry free window stores on close. */
	set_on_window_closed(callback: (window_id: string) => void): void
	/** Internal: lets desktop children free the desktop store on remove. */
	set_on_desktop_removed(callback: (desktop_id: string) => void): void
}

// wired to the workspace registry / desktop children without importing them (import cycle)
let on_window_closed_cb: ((window_id: string) => void) | null = null
let on_desktop_removed_cb: ((desktop_id: string) => void) | null = null

export
const default_state = (): DesktopsState => ({
	mode: 'fullscreen',
	desktops: [],
	selected_desktop_id: '',
})

function new_id(): string {
	return typeof crypto?.randomUUID === 'function'
		? crypto.randomUUID()
		: `id-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Толерантное чтение localStorage: битый/устаревший payload → дефолт */
export
function normalize_state(raw: string): DesktopsState {
	try {
		const parsed = JSON.parse(raw) as Partial<DesktopsState>
		// persisted state is local-only; legacy payloads have no backend field
		const desktops = (Array.isArray(parsed.desktops) ? parsed.desktops : [])
			.map(d => normalize_desktop(d, 'local'))
			.filter((d): d is Desktop => d !== null)
		const selected = typeof parsed.selected_desktop_id === 'string'
			&& desktops.some(d => d.id === parsed.selected_desktop_id)
			? parsed.selected_desktop_id
			: (desktops[0]?.id ?? '')
		return {
			mode: parsed.mode === 'desktops' ? 'desktops' : 'fullscreen',
			desktops,
			selected_desktop_id: selected,
		}
	} catch {
		return default_state()
	}
}

const DEFAULT_WINDOW_SIZE: Size = { width: 960, height: 640 }
const CASCADE_STEP = 32
const CASCADE_BASE = 48
const CLOUD_SYNC_DEBOUNCE_MS = 500

async function local_folder_exists(path: string): Promise<boolean> {
	const { stat } = await import('@tauri-apps/plugin-fs')
	try {
		return (await stat(path)).isDirectory
	} catch {
		return false
	}
}

/**
 * Startup hygiene (Tauri): drops windows pointing at local folders that
 * no longer exist — the folder was moved/renamed/deleted outside the
 * app. close_window routes them through the regular disposal hooks.
 */
export
async function prune_missing_desktop_windows(
	store: DesktopsStore,
	exists: (path: string) => Promise<boolean> = local_folder_exists,
): Promise<void> {
	for (const desktop of store.desktops) {
		const missing: string[] = []
		for (const window of desktop.windows) {
			if (window.content.kind !== 'workspace') continue
			if (window.content.item.type !== 'local') continue
			if (!(await exists(window.content.item.id))) missing.push(window.id)
		}
		for (const id of missing) store.close_window(id)
	}
}

export
function createDesktopsStore(
	state: Ref<DesktopsState>,
	cloud_desktops?: Ref<Desktop[]>,
	cloud_deps?: DesktopsCloudDeps,
): DesktopsStore {
	const cloud_ref = cloud_desktops ?? ref<Desktop[]>([])
	const last_error = ref<string | null>(null)
	// transient board focus (see DesktopsStore.is_board_focused)
	const board_focused = reactive(new Set<string>())

	function local_list(): Desktop[] {
		return state.value.desktops
	}

	function cloud_list(): Desktop[] {
		return cloud_ref.value
	}

	function all_desktops(): Desktop[] {
		return [...local_list(), ...cloud_list()]
	}

	function list_for(backend: DesktopBackend): Desktop[] {
		return backend === 'cloud' ? cloud_list() : local_list()
	}

	function find_desktop(desktop_id: string): Desktop | null {
		return all_desktops().find(d => d.id === desktop_id) ?? null
	}

	function find_window(window_id: string): { desktop: Desktop; window: AppWindow } | null {
		for (const desktop of all_desktops()) {
			const window = desktop.windows.find(w => w.id === window_id)
			if (window) return { desktop, window }
		}
		return null
	}

	function workspace_window_on(desktop: Desktop, item: WorkspacesListItem): AppWindow | undefined {
		return desktop.windows.find(w =>
			w.content.kind === 'workspace'
			&& w.content.item.type === item.type
			&& w.content.item.id === item.id,
		)
	}

	/** DesktopShell only renders the fullscreen window; leave it so floaters show. */
	function exit_fullscreen_on(desktop: Desktop) {
		let exited = false
		for (const app_window of desktop.windows) {
			if (app_window.state === 'fullscreen') {
				app_window.state = 'floating'
				exited = true
			}
		}
		if (!exited) return
		// Do not import publicRoute here — it cycles through navigatePublic → store.
		if (typeof window !== 'undefined' && window.location.pathname !== '/') {
			history.replaceState(null, '', '/')
		}
	}

	function move_item<T>(list: T[], from: number, to: number) {
		if (from === to) return
		if (from < 0 || from >= list.length) return
		const clamped = Math.max(0, Math.min(to, list.length - 1))
		list.splice(clamped, 0, ...list.splice(from, 1))
	}

	function fail(error: unknown) {
		last_error.value = error instanceof Error ? error.message : String(error)
	}

	// ---- cloud sync: debounced, last-write-wins (v1, no realtime) ----
	// last_synced mirrors what the server has; the deep watch diffs against it
	const sync_timers = new Map<string, ReturnType<typeof setTimeout>>()
	const last_synced = new Map<string, string>()

	function snapshot_of(desktop: Desktop, position: number): string {
		return JSON.stringify({
			name: desktop.name,
			xattrs: desktop.xattrs,
			windows: desktop.windows,
			position,
		})
	}

	function schedule_sync(desktop_id: string) {
		if (!cloud_deps) return
		clearTimeout(sync_timers.get(desktop_id))
		sync_timers.set(desktop_id, setTimeout(() => {
			sync_timers.delete(desktop_id)
			const index = cloud_list().findIndex(d => d.id === desktop_id)
			const desktop = cloud_list()[index]
			if (!desktop) return
			cloud_deps.update(desktop_id, {
				name: desktop.name,
				xattrs: desktop.xattrs,
				windows: desktop.windows,
				position: index,
			})
				.then(() => last_synced.set(desktop_id, snapshot_of(desktop, index)))
				.catch(fail)
		}, CLOUD_SYNC_DEBOUNCE_MS))
	}

	function forget_sync(desktop_id: string) {
		clearTimeout(sync_timers.get(desktop_id))
		sync_timers.delete(desktop_id)
		last_synced.delete(desktop_id)
	}

	/** Marks the current cloud rows as server-fresh and drops pending syncs */
	function prime_sync() {
		for (const timer of sync_timers.values()) clearTimeout(timer)
		sync_timers.clear()
		last_synced.clear()
		cloud_list().forEach((d, index) => last_synced.set(d.id, snapshot_of(d, index)))
	}

	if (cloud_deps) {
		watch(cloud_ref, () => {
			cloud_list().forEach((d, index) => {
				if (last_synced.get(d.id) !== snapshot_of(d, index)) schedule_sync(d.id)
			})
		}, { deep: true })
	}

	const store: DesktopsStore = {
		get mode() { return state.value.mode },
		get desktops() { return all_desktops() },
		get selected_desktop_id() { return state.value.selected_desktop_id },
		get selected_desktop() { return find_desktop(state.value.selected_desktop_id) },
		get last_error() { return last_error.value },

		add_desktop(name?: string, backend: DesktopBackend = 'local', path?: string) {
			const desktop: Desktop = {
				id: new_id(),
				backend,
				name: name ?? `Desktop ${all_desktops().length + 1}`,
				xattrs: {},
				windows: [],
				// adopted folders are a local-only concept (see Desktop.path)
				...(backend === 'local' && path ? { path } : {}),
			}
			const list = list_for(backend)
			if (backend === 'cloud' && cloud_deps) {
				// optimistic: the row insert runs in the background; the deep
				// watch must not re-sync it, so the snapshot is primed upfront
				const position = list.length
				last_synced.set(desktop.id, snapshot_of(desktop, position))
				list.push(desktop)
				cloud_deps.insert(desktop, position).catch((error: unknown) => {
					const index = cloud_list().findIndex(d => d.id === desktop.id)
					if (index !== -1) cloud_list().splice(index, 1)
					forget_sync(desktop.id)
					if (state.value.selected_desktop_id === desktop.id) {
						state.value.selected_desktop_id = all_desktops()[0]?.id ?? ''
					}
					fail(error)
				})
			} else {
				list.push(desktop)
			}
			state.value.selected_desktop_id = desktop.id
			return desktop
		},

		select_desktop(id: string) {
			if (!find_desktop(id)) return
			state.value.selected_desktop_id = id
		},

		rename_desktop(id: string, name: string) {
			const desktop = find_desktop(id)
			if (desktop) desktop.name = name
		},

		update_desktop_xattrs(id: string, patch: Partial<Desktop['xattrs']>) {
			const desktop = find_desktop(id)
			if (desktop) Object.assign(desktop.xattrs, patch)
		},

		reorder_desktop(from: number, to: number) {
			const local_count = local_list().length
			// merged index space: [0, local_count) local, [local_count, …) cloud;
			// a drag never crosses the group boundary, it clamps inside its group
			if (from < local_count) {
				move_item(local_list(), from, Math.min(to, local_count - 1))
			} else {
				move_item(cloud_list(), from - local_count, to - local_count)
			}
		},

		remove_desktop(id: string) {
			const merged = all_desktops()
			if (merged.length <= 1) return false
			const merged_index = merged.findIndex(d => d.id === id)
			if (merged_index === -1) return false
			const desktop = merged[merged_index]!
			const list = list_for(desktop.backend)
			const group_index = list.findIndex(d => d.id === id)
			list.splice(group_index, 1)
			forget_sync(id)
			board_focused.delete(id)
			if (state.value.selected_desktop_id === id) {
				const remaining = all_desktops()
				const neighbor = remaining[Math.min(merged_index, remaining.length - 1)]
				state.value.selected_desktop_id = neighbor?.id ?? ''
			}
			if (desktop.backend === 'cloud' && cloud_deps) {
				cloud_deps.remove(id).catch((error: unknown) => {
					cloud_list().splice(Math.min(group_index, cloud_list().length), 0, desktop)
					last_synced.set(id, snapshot_of(desktop, group_index))
					fail(error)
				})
			}
			for (const window of desktop.windows) on_window_closed_cb?.(window.id)
			on_desktop_removed_cb?.(id)
			return true
		},

		set_cloud_desktops(desktops: Desktop[]) {
			cloud_ref.value = desktops
			prime_sync()
			if (!all_desktops().some(d => d.id === state.value.selected_desktop_id)) {
				state.value.selected_desktop_id = all_desktops()[0]?.id ?? ''
			}
		},

		async sync_cloud_desktops() {
			if (!cloud_deps) return
			try {
				this.set_cloud_desktops(await cloud_deps.fetch_all())
			} catch (error) {
				fail(error)
			}
		},

		teardown_cloud_desktops() {
			for (const desktop of cloud_list()) {
				for (const window of desktop.windows) on_window_closed_cb?.(window.id)
				on_desktop_removed_cb?.(desktop.id)
			}
			this.set_cloud_desktops([])
		},

		clear_error() {
			last_error.value = null
		},

		open_window(content: WindowContent) {
			let desktop = find_desktop(state.value.selected_desktop_id)
			if (!desktop) desktop = this.add_desktop()
			// DesktopShell hides every floating window while one is fullscreen;
			// a new floating window would open invisibly unless we exit first
			exit_fullscreen_on(desktop)
			const offset = CASCADE_BASE + CASCADE_STEP * (desktop.windows.length % 8)
			const top_z = Math.max(0, ...desktop.windows.map(w => w.z))
			const window: AppWindow = {
				id: new_id(),
				content,
				position: { x: offset, y: offset },
				size: { ...DEFAULT_WINDOW_SIZE },
				state: 'floating',
				z: top_z + 1,
			}
			desktop.windows.push(window)
			// a new window takes the focus away from the board
			board_focused.delete(desktop.id)
			return window
		},

		open_or_replace_fullscreen(content: WindowContent) {
			let desktop = find_desktop(state.value.selected_desktop_id)
			if (!desktop) desktop = this.add_desktop()
			const fullscreen = desktop.windows.find(w => w.state === 'fullscreen')
			if (fullscreen) {
				fullscreen.content = content
				return fullscreen
			}
			return this.open_window(content)
		},

		open_workspace_window(item: WorkspacesListItem) {
			const desktop = find_desktop(state.value.selected_desktop_id)
			const existing = desktop && workspace_window_on(desktop, item)
			if (existing) {
				if (existing.state === 'minimized') this.restore_window(existing.id)
				else this.focus_window(existing.id)
				return existing
			}
			return this.open_window({ kind: 'workspace', item })
		},

		replace_window_workspace(window_id: string, item: WorkspacesListItem) {
			const found = find_window(window_id)
			if (!found) return null
			const existing = workspace_window_on(found.desktop, item)
			if (existing) {
				if (existing.state === 'minimized') this.restore_window(existing.id)
				else this.focus_window(existing.id)
				return existing
			}
			found.window.content = { kind: 'workspace', item }
			return found.window
		},

		set_window_content(window_id: string, content: WindowContent) {
			const found = find_window(window_id)
			if (found) found.window.content = content
		},

		close_window(window_id: string) {
			const found = find_window(window_id)
			if (!found) return
			found.desktop.windows = found.desktop.windows.filter(w => w.id !== window_id)
			on_window_closed_cb?.(window_id)
		},

		hide_window(window_id: string) {
			const found = find_window(window_id)
			if (found) found.window.state = 'minimized'
		},

		restore_window(window_id: string) {
			const found = find_window(window_id)
			if (!found) return
			found.window.state = 'floating'
			this.focus_window(window_id)
		},

		toggle_fullscreen(window_id: string) {
			const found = find_window(window_id)
			if (!found) return
			if (found.window.state === 'fullscreen') {
				exit_fullscreen_on(found.desktop)
				return
			}
			// fullscreen одновременно может быть только у одного окна десктопа
			exit_fullscreen_on(found.desktop)
			found.window.state = 'fullscreen'
		},

		focus_window(window_id: string) {
			const found = find_window(window_id)
			if (!found) return
			board_focused.delete(found.desktop.id)
			// Focusing a non-fullscreen window must reveal the desktop chrome
			// (otherwise the fullscreen window keeps covering everything)
			if (found.window.state !== 'fullscreen') {
				exit_fullscreen_on(found.desktop)
			}
			// bump the stacking order only — the windows array stays put so the
			// taskbar list does not reshuffle on every click
			const top_z = Math.max(0, ...found.desktop.windows.map(w => w.z))
			if (found.window.z < top_z || found.window.state === 'minimized') {
				found.window.z = top_z + 1
			}
		},

		is_board_focused(desktop_id: string) {
			return board_focused.has(desktop_id)
		},

		focus_board(desktop_id: string) {
			if (!find_desktop(desktop_id)) return
			board_focused.add(desktop_id)
		},

		update_window_geometry(window_id: string, geometry: { position?: Position; size?: Size }) {
			const found = find_window(window_id)
			if (!found) return
			if (geometry.position) found.window.position = geometry.position
			if (geometry.size) found.window.size = geometry.size
		},

		reorder_windows(from: number, to: number) {
			const desktop = find_desktop(state.value.selected_desktop_id)
			if (desktop) move_item(desktop.windows, from, to)
		},

		enter_desktops() {
			if (all_desktops().length === 0) this.add_desktop()
			state.value.mode = 'desktops'
		},

		exit_to_fullscreen() {
			state.value.mode = 'fullscreen'
		},

		set_on_window_closed(callback: (window_id: string) => void) {
			on_window_closed_cb = callback
		},

		set_on_desktop_removed(callback: (desktop_id: string) => void) {
			on_desktop_removed_cb = callback
		},
	}

	return reactive(store) as DesktopsStore
}

const persisted = useStorage<DesktopsState>(
	'desktops_state',
	default_state(),
	undefined,
	{
		serializer: {
			read: normalize_state,
			write: (value) => JSON.stringify(value),
		},
	},
)

const cloud_desktops = ref<Desktop[]>([])

const cloud_deps: DesktopsCloudDeps = {
	fetch_all: () => fetch_cloud_desktops(require_supabase()),
	insert: (desktop, position) => insert_cloud_desktop(require_supabase(), desktop, position),
	update: (id, patch) => update_cloud_desktop(require_supabase(), id, patch),
	remove: (id) => delete_cloud_desktop(require_supabase(), id),
}

const desktops = createDesktopsStore(persisted, cloud_desktops, cloud_deps)

export default desktops

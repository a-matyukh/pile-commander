import { reactive, ref, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import { is_desktop } from '@/isDesktop'
import { normalize_workspace_id, parent_folder_id_from_node_id } from '@/services/workspace/paths'
import store from '@/store'
import { is_missing_path_error } from '@/store/helpers/fsErrors'
import { report_error } from '@/store/helpers/reportError'
import { BROWSER_ROOT, explorer_drives, is_within } from './drives'
import { explain_folder_error } from './fsErrorMessage'

/**
 * Pages the history can stand on. Trash, a profile and an invite join this
 * list when those screens exist; they are not folders.
 */
export type ExplorerPage = 'hub' | 'account' | 'settings'

export type ExplorerLocation =
	| { kind: 'folder'; ref: FolderRef }
	| { kind: 'page'; page: ExplorerPage }

export const EXPLORER_LAST_LOCATION_KEY = 'pile_commander_explorer_location'
/** The last folder of each drive, so switching back to a drive returns to it */
export const EXPLORER_DRIVE_LOCATIONS_KEY = 'pile_commander_explorer_drive_locations'
/**
 * Set while launch opens the last place, cleared once it is open. Still set
 * at the next launch means that open hung or crashed: launch then opens the
 * default folder instead, so the app does not hang again on every start.
 */
export const EXPLORER_LAUNCH_PENDING_KEY = 'pile_commander_explorer_launch_pending'

/** How long a launch has to keep running before its last place counts as safe */
export const LAUNCH_SETTLE_MS = 10_000

type SelectionSnapshot = { ids: string[]; selection_mode: boolean }

export type ExplorerNavigationDeps = {
	/**
	 * `still_current` is false when a later navigation has already taken over.
	 * The open must then leave the current root alone.
	 */
	open_root(
		drive_id: string,
		root_id: string,
		still_current?: () => boolean,
	): Promise<WorkspaceStore>
	/** Store currently on screen. Read when leaving a folder, not opened again. */
	current_store(): WorkspaceStore | null
	default_folder(): Promise<FolderRef>
	home_path(): Promise<string>
	last_location: Ref<FolderRef | null>
	/** The last folder opened on each drive, for switching back to it. Kept in memory when absent. */
	last_by_drive?: Ref<Record<string, FolderRef>>
	/** The launch mark (see EXPLORER_LAUNCH_PENDING_KEY). Kept in memory when absent. */
	launch_pending?: Ref<boolean>
	/** Runs `done` once the launch has stayed responsive for a while. Defaults to a timer. */
	after_launch_settles?: (done: () => void) => void
	/** A bookmark whose drive cannot be opened. The shell reads `store.last_error`. */
	on_error?(error: unknown): void
}

export type ExplorerNavigation = {
	location: ExplorerLocation | null
	readonly can_go_back: boolean
	readonly can_go_forward: boolean
	open_folder(ref: FolderRef): Promise<void>
	/**
	 * Switching to a drive: its last open folder, as it was left. A folder that
	 * is gone opens its root; a root that cannot be opened opens `first`
	 */
	open_drive(first: FolderRef): Promise<void>
	/** Bookmark: a missing folder opens its drive root. An unreachable root is reported, not thrown. */
	open_bookmark(ref: FolderRef): Promise<void>
	open_page(page: ExplorerPage): Promise<void>
	/** A path inside ~ is a folder of the home root. Anything else is its own local root. */
	open_local_path(path: string): Promise<void>
	go_back(): Promise<void>
	go_forward(): Promise<void>
	/**
	 * Opens the folder that was open before exit. A folder that is gone opens
	 * the root of its drive. If that root cannot be opened, opens the default
	 * root and keeps the saved place. With nothing saved, opens the default root.
	 * If the previous launch never finished opening the saved place, opens the
	 * default root and remembers it instead.
	 */
	open_at_launch(): Promise<void>
	/** Drops a navigation still in flight. Does not close stores. */
	cancel(): void
}

export function read_folder_ref(raw: string): FolderRef | null {
	try {
		const value = JSON.parse(raw) as unknown
		if (!is_folder_ref(value)) return null
		return {
			drive_id: value.drive_id,
			root_id: value.root_id,
			folder_id: value.folder_id,
		}
	} catch {
		return null
	}
}

function is_folder_ref(value: unknown): value is FolderRef {
	if (!value || typeof value !== 'object') return false
	const ref = value as FolderRef
	return typeof ref.drive_id === 'string' && ref.drive_id !== ''
		&& typeof ref.root_id === 'string' && ref.root_id !== ''
		&& typeof ref.folder_id === 'string' && ref.folder_id !== ''
}

function folder_location(ref: FolderRef): ExplorerLocation {
	return {
		kind: 'folder',
		ref: {
			drive_id: ref.drive_id,
			root_id: ref.root_id,
			folder_id: ref.folder_id,
		},
	}
}

function same_location(a: ExplorerLocation, b: ExplorerLocation): boolean {
	if (a.kind !== b.kind) return false
	if (a.kind === 'page' && b.kind === 'page') return a.page === b.page
	if (a.kind === 'folder' && b.kind === 'folder') {
		return a.ref.drive_id === b.ref.drive_id
			&& a.ref.root_id === b.ref.root_id
			&& a.ref.folder_id === b.ref.folder_id
	}
	return false
}

function folder_key(ref: FolderRef): string {
	return `${ref.drive_id}\0${ref.root_id}\0${ref.folder_id}`
}

/** Cloud folders are paths from `/`. `root_id` there is the workspace UUID. */
function root_folder_id(ref: FolderRef): string {
	return ref.drive_id === 'cloud' ? '/' : ref.root_id
}

/**
 * The direct child of `to` on the way to `from`, when `from` sits inside `to`
 * on the same root. Going back to a parent selects that child.
 */
function ancestor_entry(from: FolderRef, to: FolderRef): string | null {
	if (from.drive_id !== to.drive_id || from.root_id !== to.root_id) return null
	const root = root_folder_id(to)
	let current = from.folder_id
	while (current !== root && current !== to.folder_id) {
		const parent = parent_folder_id_from_node_id(current, root)
		if (parent === current) return null
		if (parent === to.folder_id) return current
		current = parent
	}
	return null
}

/** The saved drive could not be opened. Launch recovers; the error is not shown. */
class DriveRootUnavailable extends Error {
	constructor(cause: unknown) {
		super(cause instanceof Error ? cause.message : 'Drive root unavailable')
		this.name = 'DriveRootUnavailable'
		this.cause = cause
	}
}

type ShowOptions = {
	/** A missing folder opens the root of its drive instead of throwing. */
	fallback_to_root: boolean
	/** Write the opened folder as the last location. */
	remember: boolean
	/** An `open_root` failure throws DriveRootUnavailable so launch can recover. */
	recover_root: boolean
}

/**
 * Back and forward live here, not on WorkspaceStore. A store's own stack has
 * no forward step and cannot cross drives or pages. Folders are opened with
 * `skipHistory` so that stack stays empty. Each new transition bumps
 * `generation`, so a slower open that finishes later does not win.
 */
export function create_explorer_navigation(deps: ExplorerNavigationDeps): ExplorerNavigation {
	const last_by_drive = deps.last_by_drive ?? ref<Record<string, FolderRef>>({})
	const selections = new Map<string, SelectionSnapshot>()
	const launch_pending = deps.launch_pending ?? ref(false)
	let launched_in_process = false
	/** Only the latest launch's settle timer may clear the mark */
	let launch_seq = 0
	const after_launch_settles = deps.after_launch_settles
		?? ((done: () => void) => { setTimeout(done, LAUNCH_SETTLE_MS) })
	let generation = 0
	const state = reactive({
		location: null as ExplorerLocation | null,
		history: [] as ExplorerLocation[],
		index: 0,
	})

	function remember_selection() {
		const current = state.location
		if (!current || current.kind !== 'folder') return
		const workspace = deps.current_store()
		if (!workspace || workspace.is_disposed) return
		if (workspace.opened_folder_id !== current.ref.folder_id) return
		selections.set(folder_key(current.ref), {
			ids: [...workspace.selection],
			selection_mode: workspace.selection_mode,
		})
	}

	function apply_selection(workspace: WorkspaceStore, ids: string[], selection_mode: boolean) {
		const children = new Set(workspace.opened_folder.children.map(child => child.id))
		const live = ids.filter(id => children.has(id))
		if (live.length === 0 || !selection_mode) workspace.exit_selection_mode()
		else workspace.enter_selection_mode()
		if (live.length > 0) workspace.set_selection(live)
	}

	async function show(
		target: ExplorerLocation,
		options: ShowOptions,
		seen: number,
	): Promise<ExplorerLocation | null> {
		if (seen !== generation) return null
		const left = state.location
		remember_selection()
		if (target.kind === 'page') return target

		let workspace: WorkspaceStore
		try {
			workspace = await deps.open_root(
				target.ref.drive_id,
				target.ref.root_id,
				() => seen === generation,
			)
		} catch (error) {
			if (seen !== generation) return null
			const explained = explain_folder_error(error, target.ref.root_id)
			if (options.recover_root) throw new DriveRootUnavailable(explained)
			throw explained
		}
		if (seen !== generation || workspace.is_disposed) return null
		let ref = target.ref
		try {
			if (workspace.opened_folder_id !== ref.folder_id) {
				const folder_id = ref.folder_id
				await workspace.open_folder(folder_id, { skipHistory: true })
			}
		} catch (error) {
			if (!options.fallback_to_root || !is_missing_path_error(error)) {
				throw explain_folder_error(error, ref.folder_id)
			}
			if (seen !== generation || workspace.is_disposed) return null
			if (workspace.opened_folder_id !== workspace.id) {
				await workspace.open_folder(workspace.id, { skipHistory: true })
			}
			ref = { ...ref, folder_id: workspace.id }
		}
		if (seen !== generation || workspace.is_disposed) return null

		const preferred = left?.kind === 'folder' ? ancestor_entry(left.ref, ref) : null
		if (preferred && workspace.opened_folder.children.some(child => child.id === preferred)) {
			apply_selection(workspace, [preferred], false)
		} else {
			const snapshot = selections.get(folder_key(ref))
			if (snapshot) apply_selection(workspace, snapshot.ids, snapshot.selection_mode)
		}
		if (options.remember) {
			deps.last_location.value = { ...ref }
			last_by_drive.value = { ...last_by_drive.value, [ref.drive_id]: { ...ref } }
		}
		return folder_location(ref)
	}

	function push(location: ExplorerLocation) {
		const current = state.history[state.index]
		if (current && same_location(current, location)) {
			state.location = current
			return
		}
		state.history = [...state.history.slice(0, state.index + 1), location]
		state.index = state.history.length - 1
		state.location = location
	}

	async function navigate(target: ExplorerLocation, fallback_to_root: boolean) {
		if (state.location && same_location(state.location, target)) return
		const seen = ++generation
		const shown = await show(target, {
			fallback_to_root,
			remember: true,
			recover_root: false,
		}, seen)
		if (!shown || seen !== generation) return
		push(shown)
	}

	async function open_drive(first: FolderRef) {
		const saved = last_by_drive.value[first.drive_id]
		if (saved) {
			const seen = ++generation
			try {
				const shown = await show(folder_location(saved), {
					fallback_to_root: true,
					remember: true,
					recover_root: true,
				}, seen)
				if (shown && seen === generation) push(shown)
				return
			} catch {
				if (seen !== generation) return
			}
		}
		await navigate(folder_location(first), false)
	}

	async function open_bookmark(ref: FolderRef) {
		const target = folder_location(ref)
		if (state.location && same_location(state.location, target)) return
		const seen = ++generation
		try {
			const shown = await show(target, {
				fallback_to_root: true,
				remember: true,
				recover_root: true,
			}, seen)
			if (!shown || seen !== generation) return
			push(shown)
		} catch (error) {
			if (seen !== generation) return
			deps.on_error?.(error)
		}
	}

	async function open_local_path(path: string) {
		const seen = generation
		const id = normalize_workspace_id(path)
		const home = normalize_workspace_id(await deps.home_path())
		if (seen !== generation) return
		const root_id = is_within(id, home) ? home : id
		await navigate(folder_location({ drive_id: 'local', root_id, folder_id: id }), false)
	}

	/** A deleted history entry stands on its drive root, without a duplicate step. */
	function stand_on(next_index: number, shown: ExplorerLocation, target: ExplorerLocation) {
		if (same_location(shown, target)) {
			state.index = next_index
			state.location = state.history[state.index]!
			return
		}
		const replaced = state.history.slice()
		replaced[next_index] = shown
		const compact: ExplorerLocation[] = []
		let index = 0
		for (let i = 0; i < replaced.length; i++) {
			const entry = replaced[i]!
			const prev = compact[compact.length - 1]
			if (prev && same_location(prev, entry)) {
				if (i === next_index) index = compact.length - 1
				continue
			}
			if (i === next_index) index = compact.length
			compact.push(entry)
		}
		state.history = compact
		state.index = index
		state.location = compact[index]!
	}

	async function go(next_index: number) {
		if (next_index < 0 || next_index >= state.history.length) return
		const target = state.history[next_index]
		if (!target) return
		const seen = ++generation
		const shown = await show(target, {
			fallback_to_root: true,
			remember: true,
			recover_root: false,
		}, seen)
		if (!shown || seen !== generation) return
		stand_on(next_index, shown, target)
	}

	async function open_saved(saved: FolderRef, seen: number): Promise<ExplorerLocation | null> {
		try {
			return await show(folder_location(saved), {
				fallback_to_root: true,
				remember: true,
				recover_root: true,
			}, seen)
		} catch (error) {
			if (seen !== generation) return null
			if (!(error instanceof DriveRootUnavailable)) throw error
			return null
		}
	}

	async function open_at_launch() {
		const seen = ++generation
		state.history = []
		state.index = 0
		state.location = null
		// Only the first launch in this process can find a mark left by a hung
		// one: a later call (the shell mounted again after the flag went off
		// and on) would read the mark its own process set seconds ago
		const interrupted = !launched_in_process && launch_pending.value
		launched_in_process = true
		const last = deps.last_location.value ? { ...deps.last_location.value } : null
		// The last place hung or crashed the previous launch: skip it once
		const saved = interrupted ? null : last
		launch_pending.value = saved !== null
		// A newer launch owns the mark from here on: an older settle timer that
		// fires while this one is still opening must not clear it
		const launch = ++launch_seq
		let shown: ExplorerLocation | null = null
		try {
			shown = saved ? await open_saved(saved, seen) : null
		} catch (error) {
			// A throw is not a hang
			launch_pending.value = false
			throw error
		}
		// A hang can also come right after the open (look-ahead reads, watch
		// events), so the mark stays until the app has kept running a while
		if (launch_pending.value) {
			after_launch_settles(() => {
				if (launch === launch_seq) launch_pending.value = false
			})
		}
		if (seen !== generation) return
		const opened = shown ?? await (async () => {
			const fallback = await deps.default_folder()
			if (seen !== generation) return null
			return show(folder_location(fallback), {
				fallback_to_root: true,
				remember: saved === null,
				recover_root: false,
			}, seen)
		})()
		if (!opened || seen !== generation) return
		state.history = []
		state.index = 0
		push(opened)
	}

	return reactive({
		get location() { return state.location },
		get can_go_back() { return state.index > 0 },
		get can_go_forward() { return state.index < state.history.length - 1 },
		open_folder: (ref: FolderRef) => navigate(folder_location(ref), false),
		open_drive,
		open_bookmark,
		open_page: (page: ExplorerPage) => navigate({ kind: 'page', page }, false),
		open_local_path,
		go_back: () => go(state.index - 1),
		go_forward: () => go(state.index + 1),
		open_at_launch,
		cancel() { generation += 1 },
	})
}

/** Each drive's last folder: a broken entry is dropped, not the whole map */
export function read_drive_locations(raw: string): Record<string, FolderRef> {
	try {
		const parsed: unknown = JSON.parse(raw)
		if (!parsed || typeof parsed !== 'object') return {}
		const result: Record<string, FolderRef> = {}
		for (const [drive_id, value] of Object.entries(parsed)) {
			const ref = read_folder_ref(JSON.stringify(value))
			if (ref && ref.drive_id === drive_id) result[drive_id] = ref
		}
		return result
	} catch {
		return {}
	}
}

export const explorer_drive_locations = useStorage<Record<string, FolderRef>>(
	EXPLORER_DRIVE_LOCATIONS_KEY,
	{},
	undefined,
	{
		serializer: {
			read: read_drive_locations,
			write: (value) => JSON.stringify(value),
		},
	},
)

export const explorer_last_location = useStorage<FolderRef | null>(
	EXPLORER_LAST_LOCATION_KEY,
	null,
	undefined,
	{
		serializer: {
			read: read_folder_ref,
			write: (value) => JSON.stringify(value),
		},
	},
)

async function home_path(): Promise<string> {
	const { homeDir } = await import('@tauri-apps/api/path')
	return homeDir()
}

export const explorer_navigation = create_explorer_navigation({
	open_root(drive_id, root_id, still_current) {
		if (drive_id === 'local') return explorer_drives.open_local_path(root_id, still_current)
		return explorer_drives.open(drive_id, root_id, still_current)
	},
	current_store: () => store.workspace,
	async default_folder() {
		if (is_desktop) {
			const home = normalize_workspace_id(await home_path())
			return { drive_id: 'local', root_id: home, folder_id: home }
		}
		return { drive_id: 'browser', root_id: BROWSER_ROOT, folder_id: BROWSER_ROOT }
	},
	home_path,
	last_location: explorer_last_location,
	last_by_drive: explorer_drive_locations,
	// Written at once: the next launch must see it even if this one hangs
	launch_pending: useStorage(EXPLORER_LAUNCH_PENDING_KEY, false, undefined, { flush: 'sync' }),
	on_error(error) {
		report_error(store, error)
	},
})

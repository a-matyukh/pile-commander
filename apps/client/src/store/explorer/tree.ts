import { reactive } from 'vue'
import type { Drive, DriveRoot, FolderRef } from '@/domain/Drive'
import type { WorkspaceStore } from '@/domain/Store'
import type { WorkspaceTree, WorkspaceTreeNode } from '@/domain/WorkspaceTree'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { is_hidden_entry_name } from '@/services/workspace/hiddenName'
import { normalize_workspace_id, parent_folder_id_from_node_id, path_separator } from '@/services/workspace/paths'
import store from '@/store'
import cloud from '@/store/cloud'
import { delete_moved_entry, entry_subtree_stamp_at, trash_entry_id } from '@pile-commander/file-manager'
import { require_supabase } from '@/services/cloud/client'
import { t } from '@/i18n'
import { forget_bookmarks, retarget_bookmarks } from './bookmarks'
import { find_tree_node } from '@/services/workspace/tree'
import { transfer_entries, type PartialCopy } from '@/store/helpers/crossStoreTransfer'
import { create_entry } from '@/store/helpers/createEntry'
import { copy_entries_into } from '@/store/helpers/copyEntriesInto'
import { apply_entry_removed } from '@/services/workspace/mutations'
import { invalidate_entry_content_caches } from '@/ui/workspace/folder-container/textContentCache'
import { report_error } from '@/store/helpers/reportError'
import {
	bookmarks as legacy_bookmarks,
	last_opened as legacy_last_opened,
} from '@/store/workspaces_list'
import { BROWSER_ROOT, explorer_drives, is_within } from './drives'
import { explain_folder_error } from './fsErrorMessage'
import { explorer_navigation, type ExplorerLocation } from './navigation'

export type ExplorerTreeRoot = {
	drive: Drive
	root: DriveRoot
	workspace: WorkspaceStore | null
	loading: boolean
}

export type ExplorerTreeDeps = {
	current_location(): ExplorerLocation | null
	open_folder(ref: FolderRef): Promise<void>
	/** The roots expanded in the tree of `drive_id`: their stores stay open */
	set_expanded(root_ids: Iterable<string>, drive_id: string | null): void
	browser_workspaces(): readonly WorkspacesListItem[]
	on_error(error: unknown): void
	/**
	 * A move across cloud workspaces is a copy and a delete. These let the
	 * delete leave no trace and never take what someone else did meanwhile:
	 * the source row and its stamp are read together by path before the copy,
	 * and the row is removed only if it is still there, unchanged (rpc.sql
	 * delete_moved_entry). Optional: without them a move removes the source
	 * to the trash
	 */
	cloud_stamp_at?(workspace_id: string, path: string): Promise<{ entry_id: string; stamp: string }>
	delete_moved_cloud_entry?(entry_id: string, stamp: string, path: string): Promise<'deleted' | 'trashed' | 'changed' | 'gone'>
	/** Trash a cloud row by id: a failed partial copy, wherever it is now */
	trash_cloud_entry?(entry_id: string): Promise<void>
	/** Creates the top-level cloud folder dropped onto the tree's empty space */
	create_cloud_root?(name: string): Promise<string | null>
	/** Deletes the source workspace after its contents moved into another root */
	delete_cloud_root?(root_id: string): Promise<void>
	/** Keeps a root's store open during an operation; returns the release */
	hold_root?(root_id: string): () => void
	/** Bookmarks at or inside a renamed or moved folder follow it */
	retarget_bookmarks?(from: FolderRef, to: FolderRef): void
	/** Bookmarks at or inside a trashed or ungrouped folder go away */
	forget_bookmarks?(gone: FolderRef): void
}

export function tree_root_folder_id(item: ExplorerTreeRoot): string {
	return item.drive.kind === 'cloud' ? '/' : item.root.id
}

export function visible_folder_children(nodes: WorkspaceTree, show_hidden: boolean): WorkspaceTree {
	return nodes.filter(node => node.type === 'folder' && (show_hidden || !is_hidden_entry_name(node.name)))
}

/** What a look-ahead read learned about a folder's subfolders */
export type FolderProbe = {
	/** Any subfolder, dot names included */
	subfolders: boolean
	/** A subfolder shown with hidden files off */
	visible_subfolders: boolean
}

/**
 * A look-ahead result: what the read found, or 'unknown' when it failed or
 * was not made (children of ~/Library). Unknown keeps the chevron, so the
 * folder can still be opened
 */
export type FolderProbeState = FolderProbe | 'unknown'

export function folder_probe_from_children(children: readonly { type: string; name: string }[]): FolderProbe {
	const folders = children.filter(child => child.type === 'folder')
	return {
		subfolders: folders.length > 0,
		visible_subfolders: folders.some(child => !is_hidden_entry_name(child.name)),
	}
}

/**
 * A folder row gets a chevron only when it has visible subfolders. An unread
 * folder gets none until its look-ahead read ends, so the chevron does not
 * blink; if that read failed or was skipped, the chevron stays so the folder
 * can be opened
 */
export function folder_has_chevron(
	node: WorkspaceTreeNode,
	show_hidden: boolean,
	probe: FolderProbeState | undefined,
): boolean {
	if (node.children_loaded) return visible_folder_children(node.children ?? [], show_hidden).length > 0
	if (!probe) return false
	if (probe === 'unknown') return true
	return show_hidden ? probe.subfolders : probe.visible_subfolders
}

/**
 * Folders of ~ that macOS guards with a privacy check. Reading one before the
 * user opens it can stall on a prompt they did not ask for, so these keep
 * their chevron unread (they nearly always have subfolders anyway)
 */
const PROTECTED_HOME_FOLDERS = new Set(['Desktop', 'Documents', 'Downloads', 'Library', 'Movies', 'Music', 'Pictures'])

/**
 * The tree never reads ahead into a place macOS guards: those folders of ~,
 * and the system folders in ~/Library. Their own subfolders are probed once
 * the user has opened them. Only the home root: other local roots (volumes)
 * are probed
 */
export function skips_probe(item: ExplorerTreeRoot, home_root_id: string | null, folder_id: string): boolean {
	if (item.drive.kind !== 'local' || !home_root_id || item.root.id !== home_root_id) return false
	const home = normalize_workspace_id(home_root_id)
	const sep = path_separator(home)
	const library = `${home}${sep}Library`
	const parent = normalize_workspace_id(parent_folder_id_from_node_id(folder_id, home))
	if (parent === library) return true
	if (parent !== home) return false
	const name = normalize_workspace_id(folder_id).slice(home.length + sep.length)
	return PROTECTED_HOME_FOLDERS.has(name)
}

/** Look-ahead reads in flight at once: in the cloud every read is a request */
export const TREE_PROBE_CONCURRENCY = 4

export function is_legacy_browser_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode): boolean {
	return item.drive.kind === 'browser'
		&& parent_folder_id_from_node_id(node.id, BROWSER_ROOT) === BROWSER_ROOT
}

export function legacy_browser_folder_name(
	id: string,
	fallback: string,
	items: readonly WorkspacesListItem[],
): string {
	const normalized = normalize_workspace_id(id)
	return items.find(item => item.type === 'browser' && normalize_workspace_id(item.id) === normalized)?.name
		?? fallback
}

function same_ref(a: FolderRef, b: FolderRef): boolean {
	return a.drive_id === b.drive_id && a.root_id === b.root_id && a.folder_id === b.folder_id
}

export function create_explorer_tree(
	deps: ExplorerTreeDeps,
	options: { probe_concurrency?: number } = {},
) {
	const state = reactive({
		roots: [] as ExplorerTreeRoot[],
		expanded_root_ids: new Set<string>(),
		/** Folders whose look-ahead read is queued or running */
		probing: new Set<string>(),
		/** Folders being moved: their row shows a spinner until the move ends */
		moving: new Set<string>(),
		/** Look-ahead results: subfolders found, or 'unknown' (failed or skipped) */
		probes: new Map<string, FolderProbeState>(),
		/**
		 * Bumped when the window comes back into focus. A collapsed folder has
		 * no watch, so what Finder did meanwhile shows up only by reading again
		 */
		round: 0,
		/** The drive whose roots are listed, empty list included; null while listing */
		listed_drive_id: null as string | null,
	})
	/** The round each folder was last read in, by probe key */
	const read_in_round = new Map<string, number>()
	const opening = new Map<string, Promise<WorkspaceStore>>()
	let generation = 0
	const probe_concurrency = options.probe_concurrency ?? TREE_PROBE_CONCURRENCY
	const probe_queue: Array<() => Promise<void>> = []
	let probes_running = 0
	let probe_epoch = 0

	const key = (item: ExplorerTreeRoot) => `${item.drive.id}\0${item.root.id}`
	const sync_expanded = () => deps.set_expanded(state.expanded_root_ids, state.listed_drive_id)
	const current_ref = () => {
		const location = deps.current_location()
		return location?.kind === 'folder' ? location.ref : null
	}

	async function ensure_workspace(item: ExplorerTreeRoot): Promise<WorkspaceStore> {
		if (item.workspace && !item.workspace.is_disposed) return item.workspace
		const item_key = key(item)
		let pending = opening.get(item_key)
		if (!pending) {
			pending = item.drive.store_for(item.root.id)
			opening.set(item_key, pending)
		}
		item.loading = true
		const live = () => state.roots.find(root => key(root) === item_key)
		try {
			const workspace = await pending
			if (!workspace.is_disposed) {
				item.workspace = workspace
				const current = live()
				if (current) current.workspace = workspace
			}
			return workspace
		} finally {
			opening.delete(item_key)
			item.loading = false
			const current = live()
			if (current) current.loading = false
		}
	}

	const probe_key = (item: ExplorerTreeRoot, folder_id: string) => `${key(item)}\0${folder_id}`

	function pump_probes() {
		while (probes_running < probe_concurrency && probe_queue.length) {
			const run = probe_queue.shift()!
			probes_running += 1
			void run().finally(() => {
				probes_running -= 1
				pump_probes()
			})
		}
	}

	/** The local drive's first root is ~ (Drive.roots) */
	function home_root_id(item: ExplorerTreeRoot): string | null {
		if (item.drive.kind !== 'local') return null
		return state.roots.find(root => root.drive.id === item.drive.id)?.root.id ?? null
	}

	/**
	 * Reads each shown, still unread folder one level ahead, so its row knows
	 * whether it has subfolders. A plain listing (fm.FolderChildren, no
	 * xattrs) that does not touch the store: no tree cache, no errors in
	 * last_error. Pass only the folders the tree shows (hidden ones filtered)
	 */
	function probe_folders(item: ExplorerTreeRoot, nodes: WorkspaceTree) {
		const workspace = item.workspace
		if (!workspace || workspace.is_disposed) return
		const epoch = probe_epoch
		const home = home_root_id(item)
		const picked = new Set<string>()
		const round = state.round
		const queued = nodes.filter(node => {
			if (node.type !== 'folder') return false
			// An expanded folder is watched. A loaded one is fresh until the
			// window has been away (round 0 means it never was)
			if (node.children_loaded && (round === 0 || workspace.is_folder_expanded(node.id))) return false
			const id = probe_key(item, node.id)
			if (picked.has(id) || state.probing.has(id)) return false
			if (node.children_loaded ? read_in_round.get(id) === round : state.probes.has(id) && read_in_round.get(id) === round) return false
			if (skips_probe(item, home, node.id)) {
				state.probes.set(id, 'unknown')
				read_in_round.set(id, round)
				return false
			}
			picked.add(id)
			return true
		})
		if (queued.length === 0) return
		for (const node of queued) {
			const id = probe_key(item, node.id)
			state.probing.add(id)
			read_in_round.set(id, round)
			probe_queue.push(async () => {
				try {
					const stale = () => epoch !== probe_epoch || workspace.is_disposed
					if (stale() || workspace.is_folder_loading(node.id)) return
					if (node.children_loaded || workspace.tree_loaded_folder_ids.has(node.id)) {
						// Cached and collapsed: read it again into the store, so the
						// chevron and its children match the disk. Expanded is watched
						if (!workspace.is_folder_expanded(node.id)) {
							await workspace.show_folder_children(node.id, undefined, { silent: true, refresh: true })
								.catch(() => {})
						}
						return
					}
					let children
					try {
						// Silent: a protected folder (~/Library/Mail) must not toast
						children = await workspace.file_manager.FolderChildren(node.id)
					} catch {
						if (!stale()) state.probes.set(id, 'unknown')
						return
					}
					if (!stale()) state.probes.set(id, folder_probe_from_children(children))
				} finally {
					if (epoch === probe_epoch) {
						state.probing.delete(id)
						// The window came back while this read ran: its result may
						// predate what Finder did, so read once more for the new round
						if (state.round !== round) probe_folders(item, [node])
					}
				}
			})
		}
		pump_probes()
	}

	function is_probing(item: ExplorerTreeRoot, folder_id: string): boolean {
		return state.probing.has(probe_key(item, folder_id))
	}

	function is_moving(item: ExplorerTreeRoot, folder_id: string): boolean {
		return state.moving.has(probe_key(item, folder_id))
	}

	function has_chevron(item: ExplorerTreeRoot, node: WorkspaceTreeNode, show_hidden: boolean): boolean {
		return folder_has_chevron(node, show_hidden, state.probes.get(probe_key(item, node.id)))
	}

	async function show_drive(drive: Drive, ref: FolderRef | null) {
		const seen = ++generation
		try {
			const roots = await drive.roots()
			if (seen !== generation) return
			const previous = state.roots
			const next_ids = new Set(roots.map(root => root.id))
			for (const old of previous) {
				if (old.drive.id === drive.id && !next_ids.has(old.root.id)) {
					state.expanded_root_ids.delete(old.root.id)
				}
			}
			if (drive.kind !== 'cloud' && roots[0]) {
				state.expanded_root_ids.add(roots[0].id)
			}
			if (ref?.drive_id === drive.id && next_ids.has(ref.root_id)) {
				state.expanded_root_ids.add(ref.root_id)
			}
			state.listed_drive_id = drive.id
			state.roots = roots.map(root => {
				const old = previous.find(item => item.drive.id === drive.id && item.root.id === root.id)
				return {
					drive,
					root,
					workspace: old?.workspace && !old.workspace.is_disposed ? old.workspace : null,
					loading: old?.loading ?? false,
				}
			})
			sync_expanded()
			await Promise.all(state.roots
				.filter(item => state.expanded_root_ids.has(item.root.id))
				.map(item => ensure_workspace(item).catch(error => deps.on_error(error))))
			if (seen !== generation || ref?.drive_id !== drive.id) return
			const current = state.roots.find(item => item.root.id === ref.root_id)
			if (current?.workspace && !current.workspace.is_disposed) {
				const workspace = current.workspace
				await workspace.expand_folder_in_sidebar(ref.folder_id)
			}
		} catch (error) {
			deps.on_error(error)
		}
	}

	function show_page() {
		generation += 1
		state.roots = []
		state.listed_drive_id = null
	}

	function is_root_expanded(item: ExplorerTreeRoot): boolean {
		return state.expanded_root_ids.has(item.root.id)
	}

	async function toggle_root(item: ExplorerTreeRoot) {
		if (is_root_expanded(item)) {
			state.expanded_root_ids.delete(item.root.id)
			sync_expanded()
			return
		}
		state.expanded_root_ids.add(item.root.id)
		sync_expanded()
		try {
			await ensure_workspace(item)
		} catch (error) {
			deps.on_error(error)
		} finally {
			if (!is_root_expanded(item)) sync_expanded()
		}
	}

	async function toggle_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode) {
		try {
			const workspace = await ensure_workspace(item)
			if (workspace.is_folder_expanded(node.id)) {
				workspace.toggle_folder_expanded(node.id)
				return
			}
			try {
				// Read here so a protected folder reports in words, not the OS text.
				// A folder read before is read again: while collapsed it had no
				// watch, so Finder may have changed it
				await workspace.show_folder_children(node.id, undefined, {
					silent: true,
					refresh: node.children_loaded,
				})
			} catch (error) {
				deps.on_error(explain_folder_error(error, node.id, node_name(item, node)))
				return
			}
			await workspace.expand_folder_in_sidebar(node.id)
		} catch (error) {
			deps.on_error(error)
		}
	}

	function folder_ref(item: ExplorerTreeRoot, folder_id: string): FolderRef {
		return { drive_id: item.drive.id, root_id: item.root.id, folder_id }
	}

	async function open_folder(item: ExplorerTreeRoot, folder_id: string) {
		try {
			await deps.open_folder(folder_ref(item, folder_id))
		} catch (error) {
			deps.on_error(error)
		}
	}

	function node_name(item: ExplorerTreeRoot, node: WorkspaceTreeNode): string {
		if (!is_legacy_browser_folder(item, node)) return node.name
		return legacy_browser_folder_name(node.id, node.name, deps.browser_workspaces())
	}

	async function create_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode | null) {
		try {
			const workspace = await ensure_workspace(item)
			const folder_id = node?.id ?? tree_root_folder_id(item)
			if (node) await workspace.expand_folder_in_sidebar(folder_id)
			else {
				state.expanded_root_ids.add(item.root.id)
				sync_expanded()
			}
			await workspace.create_folder(folder_id)
		} catch (error) {
			deps.on_error(error)
		}
	}

	function affected_current(item: ExplorerTreeRoot, folder_id: string): FolderRef | null {
		const ref = current_ref()
		return ref
			&& ref.drive_id === item.drive.id
			&& ref.root_id === item.root.id
			&& is_within(ref.folder_id, folder_id)
			? ref
			: null
	}

	async function sync_current_after_mutation(ref: FolderRef | null, workspace: WorkspaceStore) {
		if (!ref || workspace.opened_folder_id === ref.folder_id) return
		const now = current_ref()
		if (!now || !same_ref(now, ref)) return
		await deps.open_folder({ ...ref, folder_id: workspace.opened_folder_id })
	}

	async function rename_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode, name: string) {
		if (is_legacy_browser_folder(item, node)) return
		try {
			const workspace = await ensure_workspace(item)
			const affected = affected_current(item, node.id)
			await workspace.rename(node.id, name)
			const parent = parent_folder_id_from_node_id(node.id, tree_root_folder_id(item))
			const renamed = workspace.folders?.[parent]?.children.find(child => child.name === name && child.type === 'folder')
			if (renamed && renamed.id !== node.id) {
				deps.retarget_bookmarks?.(folder_ref(item, node.id), folder_ref(item, renamed.id))
			}
			await sync_current_after_mutation(affected, workspace)
		} catch (error) {
			deps.on_error(error)
		}
	}

	/**
	 * Moves a folder into another folder of the same root. A move the store
	 * refuses (into itself, a name clash on disk) reports through the store.
	 * When the current place was inside it, navigation follows the new path
	 */
	async function move_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode, target_folder_id: string) {
		const moving = probe_key(item, node.id)
		state.moving.add(moving)
		try {
			const workspace = await ensure_workspace(item)
			const affected = affected_current(item, node.id)
			const moved = await workspace.move(node.id, target_folder_id, Number.MAX_SAFE_INTEGER)
			if (moved && moved !== node.id) deps.retarget_bookmarks?.(folder_ref(item, node.id), folder_ref(item, moved))
			await sync_current_after_mutation(affected, workspace)
		} catch (error) {
			deps.on_error(error)
		} finally {
			state.moving.delete(moving)
		}
	}

	/**
	 * Moves a folder into another root of the same drive: another cloud
	 * workspace, or between ~ and a folder outside it. The cloud forbids moves
	 * across workspaces, so transfer_entries copies through both file managers
	 * and then removes the source (to the trash). When the current place was
	 * inside it, navigation follows to the new root
	 */
	async function transfer_folder(
		item: ExplorerTreeRoot,
		node: WorkspaceTreeNode,
		target: ExplorerTreeRoot,
		target_folder_id: string,
	) {
		// Both stores stay open for the whole transfer, even if the user
		// collapses a root meanwhile; released (and swept) at the end
		const releases = [item, target].map(root => deps.hold_root?.(root.root.id))
		const moving = probe_key(item, node.id)
		state.moving.add(moving)
		try {
			const source_store = await ensure_workspace(item)
			const target_store = await ensure_workspace(target)
			const affected = affected_current(item, node.id)
			const remove_source = await stamped_remove(item, node.id)
			let kept = false
			const errors_before = [source_store.last_error, target_store.last_error]
			const [moved] = await transfer_entries({
				source_store,
				target_store,
				entry_ids: [node.id],
				target_folder_id,
				mode: 'move',
				discard: target.drive.kind === 'cloud' ? discard_partial : undefined,
				remove_source: remove_source && (async () => {
					kept = !(await remove_source())
					return !kept
				}),
			})
			lift_errors([source_store, target_store], errors_before)
			if (kept) {
				// Someone changed the folder while it was copied: nothing of theirs
				// may be lost, so both stay and the user hears why
				deps.on_error(new Error(t('errors.move_kept_both', { name: node_name(item, node) })))
				return
			}
			if (moved) {
				deps.retarget_bookmarks?.(folder_ref(item, node.id), { drive_id: target.drive.id, root_id: target.root.id, folder_id: moved })
			}
			if (!moved || !affected) return
			const now = current_ref()
			if (!now || !same_ref(now, affected)) return
			await deps.open_folder({
				drive_id: target.drive.id,
				root_id: target.root.id,
				folder_id: moved + affected.folder_id.slice(node.id.length),
			})
		} catch (error) {
			deps.on_error(error)
		} finally {
			state.moving.delete(moving)
			for (const release of releases) release?.()
		}
	}

	/**
	 * The copy helpers report into each store, and the shell shows only the
	 * current one: a new failure in either store goes to the shell
	 */
	function lift_errors(stores: WorkspaceStore[], before: (string | null)[]) {
		for (const [index, store] of stores.entries()) {
			if (!store.last_error || store.last_error === before[index]) continue
			deps.on_error(new Error(store.last_error))
			store.clear_error()
		}
	}

	/**
	 * Copies a folder into another folder; the original stays. Within one
	 * root the store's copy picks a free name ("Name 2"); across roots and
	 * drives both file managers copy it, as a move does without the removal
	 */
	async function copy_folder(
		item: ExplorerTreeRoot,
		node: WorkspaceTreeNode,
		target: ExplorerTreeRoot,
		target_folder_id: string,
	) {
		const releases = [item, target].map(root => deps.hold_root?.(root.root.id))
		try {
			const source_store = await ensure_workspace(item)
			const target_store = await ensure_workspace(target)
			if (!target_store.resolve_folder_data(target_folder_id)) {
				await target_store.show_folder_children(target_folder_id)
			}
			const errors_before = [source_store.last_error, target_store.last_error]
			if (source_store === target_store) {
				await copy_entries_into(target_store, target_store.file_manager, target_folder_id, [node.id])
			} else {
				await transfer_entries({
					source_store,
					target_store,
					entry_ids: [node.id],
					target_folder_id,
					mode: 'copy',
					discard: target.drive.kind === 'cloud' ? discard_partial : undefined,
				})
			}
			lift_errors([source_store, target_store], errors_before)
		} catch (error) {
			deps.on_error(error)
		} finally {
			for (const release of releases) release?.()
		}
	}

	/** "Duplicate": a copy beside the folder, in its parent */
	async function duplicate_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode) {
		await copy_folder(item, node, item, parent_folder_id_from_node_id(node.id, tree_root_folder_id(item)))
	}

	/** A nested cloud folder dropped onto empty tree space becomes a top-level folder. */
	async function transfer_folder_to_cloud_root(item: ExplorerTreeRoot, node: WorkspaceTreeNode) {
		if (item.drive.kind !== 'cloud' || !deps.create_cloud_root) return
		const releases = [deps.hold_root?.(item.root.id)]
		const moving = probe_key(item, node.id)
		state.moving.add(moving)
		try {
			const name = node_name(item, node)
			const root_id = await deps.create_cloud_root(name)
			if (!root_id) return
			releases.push(deps.hold_root?.(root_id))
			const root = (await item.drive.roots()).find(root => root.id === root_id)
				?? { id: root_id, name, can_write: true }
			const target: ExplorerTreeRoot = { drive: item.drive, root, workspace: null, loading: false }
			const source_store = await ensure_workspace(item)
			const target_store = await ensure_workspace(target)
			await source_store.show_folder_children(node.id)
			const entry_ids = (source_store.resolve_folder_data(node.id)?.children ?? []).map(child => child.id)
			const remove_source = await stamped_remove(item, node.id)
			const errors_before = [source_store.last_error, target_store.last_error]
			const created = await transfer_entries({
				source_store,
				target_store,
				entry_ids,
				target_folder_id: '/',
				mode: 'copy',
				discard: discard_partial,
			})
			for (const [index, store] of [source_store, target_store].entries()) {
				if (!store.last_error || store.last_error === errors_before[index]) continue
				deps.on_error(new Error(store.last_error))
				store.clear_error()
			}
			if (created.length !== entry_ids.length) return

			const removed = remove_source
				? await remove_source()
				: await source_store.file_manager.remove(node.id).then(() => true)
			if (!removed) {
				deps.on_error(new Error(t('errors.move_kept_both', { name })))
				return
			}
			invalidate_entry_content_caches(source_store.content_caches, node.id)
			apply_entry_removed(source_store, node.id)

			const ref: FolderRef = { drive_id: item.drive.id, root_id, folder_id: '/' }
			await show_drive(item.drive, ref)
			await deps.open_folder(ref)
		} catch (error) {
			deps.on_error(error)
		} finally {
			state.moving.delete(moving)
			for (const release of releases) release?.()
		}
	}

	/** A cloud root dropped into another root becomes an ordinary folder there. */
	async function transfer_cloud_root(
		item: ExplorerTreeRoot,
		target: ExplorerTreeRoot,
		target_folder_id: string,
	) {
		if (item.drive.kind !== 'cloud' || target.drive.id !== item.drive.id || !deps.delete_cloud_root) return
		const releases = [item, target].map(root => deps.hold_root?.(root.root.id))
		const source_folder_id = tree_root_folder_id(item)
		const moving = probe_key(item, source_folder_id)
		state.moving.add(moving)
		try {
			const source_store = await ensure_workspace(item)
			const target_store = await ensure_workspace(target)
			const affected = affected_current(item, source_folder_id)
			const source_root = source_store.resolve_folder_data(source_folder_id)
			const entry_ids = (source_root?.children ?? []).map(child => child.id)
			const errors_before = [source_store.last_error, target_store.last_error]
			const folder = await create_entry(
				target_store,
				target_store.file_manager,
				target_folder_id,
				'folder',
				item.root.name,
				// The top-level folder's own attributes (its view, background, …)
				// stay with it, as they would on a local move
				{ xattrs: source_root?.xattrs ?? [] },
			)
			if (folder) {
				// Ink drawn on the top-level folder's own canvas moves with it.
				// Fresh ids: stroke ids are global keys and the source rows exist
				// until the source goes
				const strokes = await source_store.file_manager.strokes.list_strokes(source_folder_id)
				if (strokes.length > 0) {
					await target_store.file_manager.strokes.upsert_strokes(
						folder.id,
						strokes.map(stroke => ({ ...stroke, id: crypto.randomUUID() })),
					)
				}
			}
			const created = folder
				? await transfer_entries({
					source_store,
					target_store,
					entry_ids,
					target_folder_id: folder.id,
					mode: 'copy',
					discard: discard_partial,
				})
				: []
			for (const [index, store] of [source_store, target_store].entries()) {
				if (!store.last_error || store.last_error === errors_before[index]) continue
				deps.on_error(new Error(store.last_error))
				store.clear_error()
			}
			if (!folder || created.length !== entry_ids.length) return

			await deps.delete_cloud_root(item.root.id)
			deps.retarget_bookmarks?.(
				folder_ref(item, source_folder_id),
				{ drive_id: target.drive.id, root_id: target.root.id, folder_id: folder.id },
			)
			const destination: FolderRef | null = affected
				? {
					drive_id: target.drive.id,
					root_id: target.root.id,
					folder_id: folder.id + (affected.folder_id === source_folder_id ? '' : affected.folder_id),
				}
				: null
			await show_drive(item.drive, destination ?? current_ref())
			if (destination) await deps.open_folder(destination)
		} catch (error) {
			deps.on_error(error)
		} finally {
			state.moving.delete(moving)
			for (const release of releases) release?.()
		}
	}

	/**
	 * The source removal of a cloud move: the row and its stamp are read now,
	 * before the copy reads anything, and removed later only if it is still
	 * at this path and nothing changed. Resolves true when removed, false
	 * when kept. Null (the default remove, to the trash) off the cloud or
	 * when the stamp cannot be taken.
	 *
	 * A failed copy is not discarded without a trace: someone may already
	 * have edited what landed in the target, so it goes to the target's trash
	 * (transfer_entries' default), where nothing is lost
	 */
	async function stamped_remove(item: ExplorerTreeRoot, folder_id: string) {
		const { cloud_stamp_at, delete_moved_cloud_entry } = deps
		if (item.drive.kind !== 'cloud' || !cloud_stamp_at || !delete_moved_cloud_entry) return null
		try {
			const { entry_id, stamp } = await cloud_stamp_at(item.root.id, folder_id)
			return async () => (await delete_moved_cloud_entry(entry_id, stamp, folder_id)) !== 'changed'
		} catch {
			return null
		}
	}

	/**
	 * A failed copy into the cloud goes to the target's trash by its row id,
	 * not its path: someone may have moved it and put their own folder at
	 * that path meanwhile
	 */
	async function discard_partial(store: WorkspaceStore, copy: PartialCopy) {
		if (copy.entry_id && deps.trash_cloud_entry) await deps.trash_cloud_entry(copy.entry_id)
		else await store.file_manager.remove(copy.id)
	}

	/**
	 * When the current place was inside the removed folder, navigation goes
	 * where the store went (its root), or with `open_parent` to the removed
	 * folder's parent (the folder header's menu)
	 */
	async function remove_folder(
		item: ExplorerTreeRoot,
		node: WorkspaceTreeNode,
		options: { open_parent?: boolean } = {},
	) {
		try {
			const workspace = await ensure_workspace(item)
			const affected = affected_current(item, node.id)
			const error_before = workspace.last_error
			await workspace.remove(node.id)
			forget_if_gone(item, node, workspace, error_before)
			if (options.open_parent && await open_parent_of_gone(item, node, affected, workspace)) return
			await sync_current_after_mutation(affected, workspace)
		} catch (error) {
			deps.on_error(error)
		}
	}

	/**
	 * After the folder holding the current place is gone (removed or
	 * ungrouped), navigation goes to the folder's parent. A failed action
	 * leaves the store where it was: nowhere to go. True when it navigated
	 * or the current place moved on meanwhile
	 */
	async function open_parent_of_gone(
		item: ExplorerTreeRoot,
		node: WorkspaceTreeNode,
		affected: FolderRef | null,
		workspace: WorkspaceStore,
	): Promise<boolean> {
		if (!affected || workspace.opened_folder_id === affected.folder_id) return false
		const now = current_ref()
		if (!now || !same_ref(now, affected)) return true
		await deps.open_folder({
			...affected,
			folder_id: parent_folder_id_from_node_id(node.id, tree_root_folder_id(item)),
		})
		return true
	}

	/**
	 * "Ungroup folder": the store's uncombine moves the folder's contents
	 * into its parent and removes it. When the current place was inside it,
	 * its parent opens, as after "Move to trash" from the folder menu
	 */
	async function ungroup_folder(item: ExplorerTreeRoot, node: WorkspaceTreeNode) {
		try {
			const workspace = await ensure_workspace(item)
			const affected = affected_current(item, node.id)
			const error_before = workspace.last_error
			await workspace.uncombine_folder(node.id)
			forget_if_gone(item, node, workspace, error_before)
			if (await open_parent_of_gone(item, node, affected, workspace)) return
			await sync_current_after_mutation(affected, workspace)
		} catch (error) {
			deps.on_error(error)
		}
	}

	/** The store reports a failure instead of throwing: the folder is gone only without a new error */
	function forget_if_gone(item: ExplorerTreeRoot, node: WorkspaceTreeNode, workspace: WorkspaceStore, error_before: string | null) {
		const failed = !!workspace.last_error && workspace.last_error !== error_before
		if (failed || find_tree_node(workspace.tree, node.id)) return
		deps.forget_bookmarks?.(folder_ref(item, node.id))
	}

	function reset() {
		generation += 1
		opening.clear()
		state.roots = []
		state.listed_drive_id = null
		state.expanded_root_ids.clear()
		probe_epoch += 1
		probe_queue.length = 0
		state.probing.clear()
		state.probes.clear()
		read_in_round.clear()
	}

	/** The window is back: read the shown, unwatched folders again */
	function refresh_shown() {
		state.round += 1
	}

	return reactive({
		get roots() { return state.roots },
		get listed_drive_id() { return state.listed_drive_id },
		/** Rows pass it to their probe watch, so a new round probes again */
		get round() { return state.round },
		refresh_shown,
		show_drive,
		show_page,
		is_root_expanded,
		toggle_root,
		toggle_folder,
		open_folder,
		node_name,
		create_folder,
		rename_folder,
		move_folder,
		transfer_folder,
		copy_folder,
		duplicate_folder,
		transfer_folder_to_cloud_root,
		transfer_cloud_root,
		remove_folder,
		ungroup_folder,
		probe_folders,
		is_probing,
		is_moving,
		has_chevron,
		reset,
	})
}

export const explorer_tree = create_explorer_tree({
	current_location: () => explorer_navigation.location,
	open_folder: ref => explorer_navigation.open_folder(ref),
	set_expanded: (root_ids, drive_id) => explorer_drives.set_expanded(root_ids, drive_id),
	browser_workspaces: () => [...legacy_bookmarks.value, ...legacy_last_opened.value],
	on_error: error => report_error(store, error),
	cloud_stamp_at: (workspace_id, path) => entry_subtree_stamp_at(require_supabase(), workspace_id, path),
	delete_moved_cloud_entry: (entry_id, stamp, path) => delete_moved_entry(require_supabase(), entry_id, stamp, path),
	trash_cloud_entry: entry_id => trash_entry_id(require_supabase(), entry_id),
	create_cloud_root: name => cloud.create(name),
	delete_cloud_root: async root_id => {
		await cloud.remove(root_id)
		if (cloud.last_error) throw new Error(cloud.last_error)
	},
	hold_root: root_id => explorer_drives.hold(root_id),
	retarget_bookmarks,
	forget_bookmarks,
})

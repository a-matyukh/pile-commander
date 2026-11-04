import { reactive, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import {
	client_instance_id,
	createFileManager,
	forget_sync_device,
	list_workspace_connections,
	list_workspace_entries,
	list_workspace_strokes,
	purge_entry_id,
	touch_sync_device,
	workspace_state,
	type EntryRow,
} from '@pile-commander/file-manager'
import { is_desktop } from '@/isDesktop'
import { require_supabase } from '@/services/cloud/client'
import { create_app_cloud_file_manager } from '@/services/cloud/cloudFileManager'
import { create_sync_engine, type SyncEngine, type SyncNowOptions, type SyncStatus } from '@/services/cloud/sync/syncEngine'
import { download_scratch_dir, join_local, relative_of } from '@/services/cloud/sync/paths'
import { choose_sync_folder } from '@/services/cloud/sync/syncToFolder'
import { create_window_manager } from '@/services/window/WindowManager'
import { pile_root_name } from '@/services/workspace/pack'
import type { LocalWriter } from '@/services/cloud/sync/syncPass'
import {
	is_sync_state_path,
	new_sync_state,
	parse_sync_state,
	other_copy_link,
	sync_state_dir,
	sync_state_path,
	take_over_state,
	type SyncLinkOwner,
} from '@/services/cloud/sync/stateFile'
import type { CloudEntry, SyncState } from '@/services/cloud/sync/types'
import cloud from '@/store/cloud'

/** A local folder kept in sync with a cloud workspace, on this device. */
export type SyncLink = {
	/** The folder's absolute path. */
	root: string
	name: string
	workspace_id: string
	user_id: string
}

/** Links by folder path, so the app syncs them from launch on, open or not. */
const links = useStorage<Record<string, SyncLink>>('local_sync_links', {})

/** Status per linked folder path. */
export const sync_statuses: Record<string, SyncStatus> = reactive({})

const engines = new Map<string, SyncEngine>()

/**
 * How often this copy re-stamps a workspace it syncs. The stamp is its
 * record in the cloud, which the web reads to show the folder as synced;
 * passes can run every few seconds, the stamp only has to say "lately"
 */
const STAMP_EVERY_MS = 10 * 60_000

/** Last stamp per account and workspace */
const stamped = new Map<string, number>()

function stamp_key(link: SyncLink): string {
	return `${link.user_id}\0${link.workspace_id}`
}

/** Best-effort: without the record the folder only misses its badge on other devices */
function stamp_sync_device(link: SyncLink, options: { now?: boolean } = {}): void {
	if (cloud.user?.id !== link.user_id) return
	const key = stamp_key(link)
	const at = Date.now()
	if (!options.now && at - (stamped.get(key) ?? 0) < STAMP_EVERY_MS) return
	stamped.set(key, at)
	void (async () => touch_sync_device(require_supabase(), link.workspace_id, client_instance_id()))()
		.catch((error: unknown) => console.warn('[sync] could not record this device', error))
}

/** The cloud forgets that a copy of the app syncs this workspace (this copy by default) */
function forget_sync_record(link: SyncLink, device_id = client_instance_id()): void {
	stamped.delete(stamp_key(link))
	if (cloud.user?.id !== link.user_id) return
	void (async () => forget_sync_device(require_supabase(), link.workspace_id, device_id))()
		.catch((error: unknown) => console.warn('[sync] could not remove the device record', error))
}

export function sync_link_of(root: string): SyncLink | null {
	return links.value[root] ?? null
}

/** Paths of every folder linked on this device, for any account. */
export function sync_link_roots(): string[] {
	return Object.keys(links.value)
}

/** The folder this account syncs with a cloud workspace on this device, if any. */
export function synced_folder_of(workspace_id: string, user_id = cloud.user?.id): SyncLink | null {
	return Object.values(links.value).find(link => link.workspace_id === workspace_id && link.user_id === user_id) ?? null
}

function owner_of(link: SyncLink): SyncLinkOwner {
	return {
		root_path: link.root,
		device_id: client_instance_id(),
		user_id: link.user_id,
		workspace_id: link.workspace_id,
	}
}

function cloud_entry(row: EntryRow): CloudEntry {
	return {
		id: row.id,
		parent_id: row.parent_id,
		path: row.path,
		name: row.name,
		kind: row.kind,
		size: row.size_bytes ?? 0,
		modified_at: row.kind === 'folder' ? row.updated_at : row.content_modified_at ?? row.updated_at,
		is_blob: row.storage_key !== null,
		xattrs: row.xattrs ?? {},
	}
}

async function fs() {
	return import('@tauri-apps/plugin-fs')
}

async function load_state(link: SyncLink): Promise<SyncState | null> {
	const { readTextFile } = await fs()
	try {
		return parse_sync_state(await readTextFile(sync_state_path(link.root)), owner_of(link))
	} catch {
		return null
	}
}

/** Written to a twin and renamed over: a crash never leaves half a file. */
async function save_state(link: SyncLink, state: SyncState): Promise<void> {
	const { mkdir, rename, writeTextFile } = await fs()
	const path = sync_state_path(link.root)
	await mkdir(sync_state_dir(link.root), { recursive: true })
	await writeTextFile(`${path}.tmp`, JSON.stringify(state))
	await rename(`${path}.tmp`, path)
}

async function remove_state(root: string): Promise<void> {
	const { remove } = await fs()
	await remove(sync_state_path(root)).catch(() => {})
}

/** Plugin-fs writes into the synced folder, the system trash through the app's `trash_path` command. */
function local_writer(root: string): LocalWriter {
	return {
		async write_file(folder, name, data) {
			const { mkdir, remove, rename, writeFile } = await fs()
			// Beside the target, inside `.pile`: listings and the watcher filter skip it.
			// A cover already lives in `.pile`, so its temporary file stays there.
			const scratch = download_scratch_dir(folder)
			await mkdir(scratch, { recursive: true })
			const temporary = join_local(scratch, `sync-${crypto.randomUUID()}.tmp`)
			await writeFile(temporary, new Uint8Array(await data.arrayBuffer()))
			try {
				await rename(temporary, join_local(folder, name))
			} catch (error) {
				await remove(temporary).catch(() => {})
				throw error
			}
		},
		async trash(path) {
			const relative = relative_of(root, path)
			// `trash_path` trusts the path it gets: only below the synced folder
			if (relative === null || relative === '') throw new Error(`refusing to trash ${path}`)
			const { invoke } = await import('@tauri-apps/api/core')
			await invoke('trash_path', { path })
		},
	}
}

function start_engine(link: SyncLink): void {
	if (engines.has(link.root)) return
	const local_fm = createFileManager('local')
	// One instance for the life of the engine: replace_file remembers an old
	// backend that does not echo `replace`, and a new instance would forget it.
	const cloud_fm = create_app_cloud_file_manager(link.workspace_id)
	const engine = create_sync_engine({
		load_state: () => load_state(link),
		save_state: state => save_state(link, state),
		pass_deps: () => ({
			local_fm,
			root: link.root,
			writer: local_writer(link.root),
			save_progress: state => save_state(link, state),
			stat: async (id) => {
				const info = await (await fs()).stat(id)
				return { size: info.size, mtime_ms: info.mtime?.getTime() ?? 0 }
			},
			cloud_fm,
			replace_blob: (cloud_path, blob, mime) => cloud_fm.replace_file(cloud_path, blob, mime),
			list_cloud: async () => (await list_workspace_entries(require_supabase(), link.workspace_id)).map(cloud_entry),
			list_cloud_layout: async () => {
				const client = require_supabase()
				const [strokes, connections] = await Promise.all([
					list_workspace_strokes(client, link.workspace_id),
					list_workspace_connections(client, link.workspace_id),
				])
				return { strokes, connections }
			},
			purge: cloud_id => purge_entry_id(require_supabase(), cloud_id),
		}),
		max_file_bytes: () => cloud.billing?.max_file_bytes ?? Number.POSITIVE_INFINITY,
		workspace_state: () => workspace_state(require_supabase(), link.workspace_id),
		root_present: async () => {
			try {
				const info = await (await fs()).stat(link.root)
				return info.isDirectory
			} catch {
				return false
			}
		},
		// joins the workspace's realtime channels itself, board open or not
		watch_cloud: on_change => cloud_fm.watch_workspace(on_change),
		watch: async (on_change) => {
			const { watch: fs_watch } = await fs()
			return fs_watch(link.root, (event) => {
				if (event.paths.every(is_sync_state_path)) return
				on_change()
			}, { recursive: true, delayMs: 500 })
		},
		on_status: (status) => {
			// A link to a cloud folder that no longer exists, with no link file
			// left in the folder: drop the record, so the folder stops showing
			// as synced (the folder itself stays as it is)
			if (status.reason === 'link_stale') {
				void unlink_folder(link.root)
				return
			}
			// The whole status, including folders kept for hidden files.
			sync_statuses[link.root] = status
			if (status.phase === 'idle' && status.last_synced_at) stamp_sync_device(link)
		},
	})
	engines.set(link.root, engine)
	void engine.start().catch((error: unknown) => console.error('[sync] start failed', error))
}

function stop_engine(root: string): void {
	engines.get(root)?.stop()
	engines.delete(root)
	delete sync_statuses[root]
}

/** Starts the links of the signed-in account and stops every other one. */
function sync_engines_with_account(user_id: string | null): void {
	for (const root of [...engines.keys()]) {
		if (links.value[root]?.user_id !== user_id) stop_engine(root)
	}
	if (!user_id) return
	for (const link of Object.values(links.value)) {
		if (link.user_id === user_id) start_engine(link)
	}
}

/**
 * Links a local folder to a cloud workspace and starts syncing it. The first
 * pass adopts what the cloud already holds at the same paths (the copy just
 * made, or an earlier one: `adopt_before` marks it)
 */
export async function link_folder(input: {
	root: string
	name: string
	workspace_id: string
	exclude?: string[]
	adopt_before?: number
}): Promise<void> {
	const user = cloud.user
	if (!is_desktop || !user) throw new Error('Sign in to sync this folder')
	// one folder per cloud workspace on a device: two would write each other's files
	const other = synced_folder_of(input.workspace_id, user.id)
	if (other && other.root !== input.root) {
		throw new Error(`This cloud workspace already syncs with ${other.root} on this computer.`)
	}
	stop_engine(input.root)
	const link: SyncLink = { root: input.root, name: input.name, workspace_id: input.workspace_id, user_id: user.id }
	await save_state(link, new_sync_state(owner_of(link), { exclude: input.exclude, adopt_before: input.adopt_before }))
	links.value = { ...links.value, [input.root]: link }
	start_engine(link)
	// at once: the first pass of a large workspace can take a while
	stamp_sync_device(link, { now: true })
}

/**
 * "Sync to a folder on this computer" for a cloud workspace: a new empty
 * folder (inside the parent the person picks, `~/Pile Commander` suggested)
 * is linked to it, and the first pass downloads the whole workspace. A
 * workspace already synced on this device returns its folder instead.
 * Returns the folder, or null when the person cancels.
 */
export async function sync_workspace_to_folder(workspace: { id: string; name: string }): Promise<string | null> {
	const existing = synced_folder_of(workspace.id)
	if (existing) return existing.root
	const { homeDir, join } = await import('@tauri-apps/api/path')
	const { mkdir, readDir } = await fs()
	const home = await homeDir()
	const folder_name = pile_root_name(workspace.name)
	const root = await choose_sync_folder({
		home,
		suggested_parent: await join(home, 'Pile Commander'),
		pick_parent: async default_path => (await create_window_manager().pick_folder({
			title: `Choose where "${folder_name}" syncs on this computer`,
			default_path,
		}))?.folder_id ?? null,
		join,
		is_free: async (path) => {
			try {
				return (await readDir(path)).length === 0
			} catch {
				return true // missing
			}
		},
		mkdir: path => mkdir(path, { recursive: true }),
	}, folder_name)
	if (!root) return null
	await link_folder({ root, name: folder_name, workspace_id: workspace.id })
	return root
}

/** Stops syncing a folder. Both the folder and its cloud workspace stay as they are. */
export async function unlink_folder(root: string): Promise<void> {
	const link = links.value[root]
	stop_engine(root)
	if (link) forget_sync_record(link)
	const next = { ...links.value }
	delete next[root]
	links.value = next
	await remove_state(root)
}

/** A folder this account syncs from another copy of the app (its link file is not this copy's) */
export type OtherCopyLink = {
	workspace_id: string
	/** The cloud folder's name */
	name: string
	/** The other copy's id, as its link file names it */
	device_id: string
}

/**
 * The folder's link, when another copy of the app wrote it (another build,
 * or this app before its data was reset): this copy does not sync it until
 * the person says to continue here. Null when this copy links it already,
 * when the cloud folder is not in this account's list, or when this copy
 * syncs that cloud folder with another folder.
 */
export async function other_copy_link_of(root: string): Promise<OtherCopyLink | null> {
	const user = cloud.user
	if (!is_desktop || !user || links.value[root]) return null
	let text: string
	try {
		text = await (await fs()).readTextFile(sync_state_path(root))
	} catch {
		return null
	}
	const found = other_copy_link(text, { root_path: root, user_id: user.id, device_id: client_instance_id() })
	if (!found) return null
	const workspace = cloud.workspaces.find(ws => ws.id === found.workspace_id)
	if (!workspace || synced_folder_of(found.workspace_id, user.id)) return null
	return { workspace_id: found.workspace_id, name: workspace.name, device_id: found.device_id }
}

/**
 * "Continue syncing here": the link file becomes this copy's (its base
 * snapshot stays, so deletes and conflicts stay right) and the folder syncs
 * from this copy on. The other copy, still running, pauses as unlinked
 */
export async function take_over_link(root: string, name: string): Promise<void> {
	const user = cloud.user
	if (!is_desktop || !user) throw new Error('Sign in to sync this folder')
	const found = await other_copy_link_of(root)
	if (!found) throw new Error('This folder is no longer linked from another copy of the app.')
	const link: SyncLink = { root, name, workspace_id: found.workspace_id, user_id: user.id }
	const text = await (await fs()).readTextFile(sync_state_path(root))
	const state = take_over_state(text, owner_of(link), found.device_id)
	if (!state) throw new Error('This folder\'s link file could not be read.')
	stop_engine(root)
	await save_state(link, state)
	links.value = { ...links.value, [root]: link }
	start_engine(link)
	// the other copy pauses as unlinked: its record goes, this copy's takes over
	forget_sync_record(link, found.device_id)
	stamp_sync_device(link, { now: true })
}

export async function sync_now(root: string, options: SyncNowOptions = {}): Promise<void> {
	await engines.get(root)?.sync_now(options)
}

if (is_desktop) {
	watch(() => cloud.user?.id ?? null, sync_engines_with_account, { immediate: true })
}

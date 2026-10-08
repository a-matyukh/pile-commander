import { reactive, watch } from 'vue'
import { useStorage } from '@vueuse/core'
import {
	client_instance_id,
	createFileManager,
	list_workspace_entries,
	purge_entry_id,
	type EntryRow,
} from '@pile-commander/file-manager'
import { is_desktop } from '@/isDesktop'
import { require_supabase } from '@/services/cloud/client'
import { create_app_cloud_file_manager } from '@/services/cloud/cloudFileManager'
import { create_sync_engine, type SyncEngine, type SyncStatus } from '@/services/cloud/sync/syncEngine'
import {
	is_sync_state_path,
	new_sync_state,
	parse_sync_state,
	sync_state_dir,
	sync_state_path,
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

export function sync_link_of(root: string): SyncLink | null {
	return links.value[root] ?? null
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
			stat: async (id) => {
				const info = await (await fs()).stat(id)
				return { size: info.size, mtime_ms: info.mtime?.getTime() ?? 0 }
			},
			cloud_fm,
			replace_blob: (cloud_path, blob, mime) => cloud_fm.replace_file(cloud_path, blob, mime),
			list_cloud: async () => (await list_workspace_entries(require_supabase(), link.workspace_id)).map(cloud_entry),
			purge: cloud_id => purge_entry_id(require_supabase(), cloud_id),
		}),
		max_file_bytes: () => cloud.billing?.max_file_bytes ?? Number.POSITIVE_INFINITY,
		watch: async (on_change) => {
			const { watch: fs_watch } = await fs()
			return fs_watch(link.root, (event) => {
				if (event.paths.every(is_sync_state_path)) return
				on_change()
			}, { recursive: true, delayMs: 500 })
		},
		on_status: (status) => {
			sync_statuses[link.root] = status
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
	stop_engine(input.root)
	const link: SyncLink = { root: input.root, name: input.name, workspace_id: input.workspace_id, user_id: user.id }
	await save_state(link, new_sync_state(owner_of(link), { exclude: input.exclude, adopt_before: input.adopt_before }))
	links.value = { ...links.value, [input.root]: link }
	start_engine(link)
}

/** Stops syncing a folder. Both the folder and its cloud workspace stay as they are. */
export async function unlink_folder(root: string): Promise<void> {
	stop_engine(root)
	const next = { ...links.value }
	delete next[root]
	links.value = next
	await remove_state(root)
}

export async function sync_now(root: string, options: { allow_mass_delete?: boolean } = {}): Promise<void> {
	await engines.get(root)?.sync_now(options)
}

if (is_desktop) {
	watch(() => cloud.user?.id ?? null, sync_engines_with_account, { immediate: true })
}

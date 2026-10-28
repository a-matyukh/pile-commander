import { useStorage } from '@vueuse/core'
import type { FolderRef } from '@/domain/Drive'
import type { WorkspacesListItem } from '@/domain/WorkspacesList'
import { t } from '@/i18n'
import { normalize_workspace_id, path_separator } from '@/services/workspace/paths'
import cloud from '@/store/cloud'
import { BROWSER_ROOT, is_within } from './drives'
import { system_folder_name } from './folder_cover'
import { explorer_home, read_explorer_home } from './home'

read_explorer_home()
import {
	bookmarks as legacy_bookmarks,
	filter_existing_workspaces,
	last_opened as legacy_last_opened,
	on_cloud_workspaces_synced,
	workspace_existence_checks,
} from '@/store/workspaces_list'

export const EXPLORER_BOOKMARKS_KEY = 'pile_commander_explorer_bookmarks'
export const EXPLORER_LAST_OPENED_KEY = 'pile_commander_explorer_last_opened'
/** Set after the one transfer from the old lists. Those keys stay untouched. */
export const EXPLORER_LISTS_MIGRATED_KEY = 'pile_commander_explorer_lists_migrated'

function is_folder_ref(value: unknown): value is FolderRef {
	if (!value || typeof value !== 'object') return false
	const ref = value as FolderRef
	return typeof ref.drive_id === 'string' && ref.drive_id !== ''
		&& typeof ref.root_id === 'string' && ref.root_id !== ''
		&& typeof ref.folder_id === 'string' && ref.folder_id !== ''
}

export function read_folder_refs(raw: string): FolderRef[] {
	try {
		const value = JSON.parse(raw) as unknown
		if (!Array.isArray(value)) return []
		return dedupe(value.filter(is_folder_ref).map(ref => ({ ...ref })))
	} catch {
		return []
	}
}

const folder_refs_serializer = {
	read: read_folder_refs,
	write: (value: FolderRef[]) => JSON.stringify(dedupe(value)),
}

export const explorer_bookmarks = useStorage<FolderRef[]>(
	EXPLORER_BOOKMARKS_KEY,
	[],
	undefined,
	{ serializer: folder_refs_serializer },
)

export const explorer_last_opened = useStorage<FolderRef[]>(
	EXPLORER_LAST_OPENED_KEY,
	[],
	undefined,
	{ serializer: folder_refs_serializer },
)

export const explorer_lists_migrated = useStorage(EXPLORER_LISTS_MIGRATED_KEY, false)

function same_ref(a: FolderRef, b: FolderRef): boolean {
	return a.drive_id === b.drive_id && a.root_id === b.root_id && a.folder_id === b.folder_id
}

function dedupe(refs: FolderRef[]): FolderRef[] {
	const seen = new Set<string>()
	const result: FolderRef[] = []
	for (const ref of refs) {
		const key = `${ref.drive_id}\0${ref.root_id}\0${ref.folder_id}`
		if (seen.has(key)) continue
		seen.add(key)
		result.push(ref)
	}
	return result
}

/**
 * Old entries are workspace roots.
 * Local: that path is both the root and the folder.
 * Cloud: `root_id` is the workspace id, the store's root folder is `/`.
 * Browser: one drive root, `folder_id` is the old path under it.
 * Demo is a public route, not a drive, so those entries are dropped.
 */
export function legacy_item_to_folder_ref(item: WorkspacesListItem): FolderRef | null {
	if (item.type === 'demo') return null
	if (item.type === 'cloud') {
		if (!item.id) return null
		return { drive_id: 'cloud', root_id: item.id, folder_id: '/' }
	}
	if (item.type === 'browser') {
		if (!item.id) return null
		return { drive_id: 'browser', root_id: BROWSER_ROOT, folder_id: item.id }
	}
	if (item.type !== 'local') return null
	const id = normalize_workspace_id(item.id)
	if (!id) return null
	return { drive_id: 'local', root_id: id, folder_id: id }
}

export type LegacyImportOptions = {
	exists: {
		local?: (path: string) => Promise<boolean>
		browser?: (path: string) => Promise<boolean>
	}
	/**
	 * Cloud workspaces that still exist. `null` means the list is not known
	 * yet (signed out, or the fetch has not answered), so cloud entries stay.
	 */
	cloud_ids: Set<string> | null
}

/** Copies one old list into FolderRefs. Does not write either store. */
export async function import_legacy_list(
	list: readonly WorkspacesListItem[],
	options: LegacyImportOptions,
): Promise<FolderRef[]> {
	const snapshot = list.map(item => ({ ...item }))
	const existing = await filter_existing_workspaces(snapshot, options.exists)
	const kept = options.cloud_ids
		? existing.filter(item => item.type !== 'cloud' || options.cloud_ids!.has(item.id))
		: existing
	const refs: FolderRef[] = []
	for (const item of kept) {
		const ref = legacy_item_to_folder_ref(item)
		if (ref) refs.push(ref)
	}
	return dedupe(refs)
}

export function is_bookmarked(ref: FolderRef): boolean {
	return explorer_bookmarks.value.some(item => same_ref(item, ref))
}

export function folder_ref_key(ref: FolderRef): string {
	return `${ref.drive_id}\0${ref.root_id}\0${ref.folder_id}`
}

function basename(id: string): string {
	const sep = path_separator(id)
	const index = id.lastIndexOf(sep)
	const name = index === -1 ? id : id.slice(index + 1)
	return name || id
}

function legacy_display_name(id: string): string | null {
	const item = [...legacy_bookmarks.value, ...legacy_last_opened.value].find(entry => entry.id === id)
	return item?.name || null
}

/** Label for a bookmark pill. Browser folders keep the name from the old list. */
export function bookmark_name(ref: FolderRef): string {
	if (ref.drive_id === 'cloud') {
		return cloud.workspaces.find(ws => ws.id === ref.root_id)?.name
			?? legacy_display_name(ref.root_id)
			?? ref.root_id
	}
	if (ref.drive_id === 'browser') {
		if (ref.folder_id === BROWSER_ROOT) return t('source.browser_disk')
		return legacy_display_name(ref.folder_id) ?? basename(ref.folder_id)
	}
	return system_folder_name(ref, explorer_home.value) ?? basename(ref.folder_id)
}

export function move_bookmark(key: string, target_key: string, after: boolean) {
	const item = explorer_bookmarks.value.find(entry => folder_ref_key(entry) === key)
	if (!item || key === target_key) return
	const rest = explorer_bookmarks.value.filter(entry => folder_ref_key(entry) !== key)
	const target = rest.findIndex(entry => folder_ref_key(entry) === target_key)
	if (target < 0) return
	rest.splice(target + (after ? 1 : 0), 0, item)
	explorer_bookmarks.value = rest
}

export function add_bookmark(ref: FolderRef): void {
	const next = { ...ref }
	explorer_bookmarks.value = [
		next,
		...explorer_bookmarks.value.filter(item => !same_ref(item, next)),
	]
	explorer_last_opened.value = explorer_last_opened.value.filter(item => !same_ref(item, next))
}

export function remove_bookmark(ref: FolderRef): void {
	explorer_bookmarks.value = explorer_bookmarks.value.filter(item => !same_ref(item, ref))
}

/**
 * A folder was renamed or moved: bookmarks (and remembered places) at it or
 * inside it follow to the new address, so they keep their name and still open
 */
export function retarget_bookmarks(from: FolderRef, to: FolderRef): void {
	const follow = (list: FolderRef[]) => {
		let changed = false
		const next = list.map(ref => {
			if (ref.drive_id !== from.drive_id || ref.root_id !== from.root_id) return ref
			if (!is_within(ref.folder_id, from.folder_id)) return ref
			changed = true
			return { drive_id: to.drive_id, root_id: to.root_id, folder_id: to.folder_id + ref.folder_id.slice(from.folder_id.length) }
		})
		return changed ? next : list
	}
	explorer_bookmarks.value = follow(explorer_bookmarks.value)
	explorer_last_opened.value = follow(explorer_last_opened.value)
}

/**
 * A folder was trashed or ungrouped in the app: bookmarks (and remembered
 * places) at it or inside it go away instead of pointing at nothing
 */
export function forget_bookmarks(gone: FolderRef): void {
	const keep = (list: FolderRef[]) => {
		const next = list.filter(ref => ref.drive_id !== gone.drive_id
			|| ref.root_id !== gone.root_id
			|| !is_within(ref.folder_id, gone.folder_id))
		return next.length === list.length ? list : next
	}
	explorer_bookmarks.value = keep(explorer_bookmarks.value)
	explorer_last_opened.value = keep(explorer_last_opened.value)
}

/** Remembers a folder that is not already bookmarked. The list is not shown yet. */
export function remember_opened(ref: FolderRef): void {
	const next = { ...ref }
	if (explorer_bookmarks.value.some(item => same_ref(item, next))) return
	explorer_last_opened.value = [
		next,
		...explorer_last_opened.value.filter(item => !same_ref(item, next)),
	]
}

/**
 * One transfer into the new keys. Reads the old lists and writes only
 * `explorer_bookmarks` / `explorer_last_opened`. A second call does nothing,
 * so later edits of the old lists (the flag-off window) are not copied again.
 */
export async function migrate_explorer_lists(
	cloud_ids: Set<string> | null,
	exists = workspace_existence_checks(),
): Promise<void> {
	if (explorer_lists_migrated.value) return
	const options = { exists, cloud_ids }
	const [next_bookmarks, next_last_opened] = await Promise.all([
		import_legacy_list(legacy_bookmarks.value, options),
		import_legacy_list(legacy_last_opened.value, options),
	])
	if (explorer_lists_migrated.value) return
	explorer_bookmarks.value = next_bookmarks
	explorer_last_opened.value = next_last_opened
	explorer_lists_migrated.value = true
}

/**
 * `on_cloud_workspaces_synced` only runs when a fetch finishes. It does not
 * replay, so a listener added after that misses the list until the next sync.
 * The module is loaded with the app, before the first fetch, and remembers
 * that a sync has happened. A later shell mount then reads `cloud.workspaces`
 * as it stands, including an empty list.
 */
let cloud_list_loaded = false

on_cloud_workspaces_synced(() => {
	cloud_list_loaded = true
})

function cloud_ids_now(): Set<string> {
	return new Set(cloud.workspaces.map(ws => ws.id))
}

function cloud_ids_for_migration(): Promise<Set<string> | null> {
	if (!cloud.user) return Promise.resolve(null)
	// A non-empty list was loaded before this module subscribed. An empty
	// list counts only after a sync this module has seen, so the first fetch
	// (still empty, not started) is not mistaken for "no cloud workspaces".
	const loaded = !cloud.is_loading && (cloud_list_loaded || cloud.workspaces.length > 0)
	if (loaded) return Promise.resolve(cloud_ids_now())
	return new Promise(resolve => {
		const stop = on_cloud_workspaces_synced(() => {
			stop()
			resolve(cloud_ids_now())
		})
	})
}

let migration_pending = false

/** Starts the one transfer. Does not block the shell, and never writes the old keys. */
export function start_explorer_list_migration(): void {
	if (explorer_lists_migrated.value || migration_pending) return
	migration_pending = true
	void cloud_ids_for_migration()
		.then(cloud_ids => migrate_explorer_lists(cloud_ids))
		.catch(error => {
			migration_pending = false
			console.error('[explorer] failed to migrate bookmarks', error)
		})
}

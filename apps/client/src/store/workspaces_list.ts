import { WorkspacesList, WorkspacesListItem } from "@/domain/WorkspacesList"
import { is_desktop } from "@/isDesktop"
import { browser_entry_exists } from "@/services/desktop/browserDesktopFolders"
import { normalize_workspace_id } from "@/services/workspace/paths"
import { useStorage } from '@vueuse/core'

const normalize_item = (ws: WorkspacesListItem): WorkspacesListItem =>
	ws.type === 'local' ? { ...ws, id: normalize_workspace_id(ws.id) } : ws

const unique_by_id = (list: WorkspacesList): WorkspacesList => {
	const seen = new Set<string>()
	const result: WorkspacesList = []
	for (const item of list) {
		const normalized = normalize_item(item)
		if (seen.has(normalized.id)) continue
		seen.add(normalized.id)
		result.push(normalized)
	}
	return result
}

const workspaces_list_serializer = {
	read: (raw: string) => unique_by_id(JSON.parse(raw) as WorkspacesList),
	write: (value: WorkspacesList) => JSON.stringify(unique_by_id(value)),
}

//////// Bookmarks

export
const bookmarks = useStorage<WorkspacesList>(
	'workspaces_list_bookmarks',
	[],
	undefined,
	{ serializer: workspaces_list_serializer },
)
export
const add_to_bookmarks = (ws: WorkspacesListItem) => {
	const item = normalize_item(ws)
	bookmarks.value = unique_by_id([
		item,
		...bookmarks.value.filter(existing => existing.id !== item.id),
	])
	remove_from_last_opened(item)
}

export
const remove_from_bookmarks = (ws: WorkspacesListItem) => {
	const id = normalize_item(ws).id
	bookmarks.value = bookmarks.value.filter(item => item.id !== id)
}

//////// Last opened

export
const last_opened = useStorage<WorkspacesList>(
	'workspaces_list_last_opened',
	[],
	undefined,
	{ serializer: workspaces_list_serializer },
)
export
const add_to_last_opened = (ws: WorkspacesListItem) => {
	const item = normalize_item(ws)
	if (bookmarks.value.some(existing => existing.id === item.id)) return
	last_opened.value = unique_by_id([
		item,
		...last_opened.value.filter(existing => existing.id !== item.id),
	])
}

export
const remove_from_last_opened = (ws: WorkspacesListItem) => {
	const id = normalize_item(ws).id
	last_opened.value = last_opened.value.filter(item => item.id !== id)
}

/** Removes a workspace from both bookmarks and last opened (by id). */
export
const remove_workspace_from_lists = (id: string) => {
	bookmarks.value = bookmarks.value.filter(item => item.id !== id)
	last_opened.value = last_opened.value.filter(item => item.id !== id)
}

/** Drops cloud workspaces that no longer exist on the server. */
export
const sync_cloud_workspaces_list = (existing_ids: Set<string>) => {
	const keep = (list: WorkspacesList): WorkspacesList =>
		list.filter(item => item.type !== 'cloud' || existing_ids.has(item.id))

	const next_bookmarks = keep(bookmarks.value)
	const next_last_opened = keep(last_opened.value)

	if (!same_workspace_ids(bookmarks.value, next_bookmarks)) {
		bookmarks.value = next_bookmarks
	}
	if (!same_workspace_ids(last_opened.value, next_last_opened)) {
		last_opened.value = next_last_opened
	}

	for (const listener of synced_listeners) listener()
}

// ---- cloud list sync wiring (registry pattern: both cloud.ts and
// desktopChildren.ts point here, avoiding an import cycle between them) ----

const synced_listeners = new Set<() => void>()

/**
 * Fired after every cloud workspaces list sync (fetch_workspaces tail).
 * Cloud desktop boards listen to keep their workspace tiles in step with
 * sidebar renames/removals. Returns an unsubscribe.
 */
export
const on_cloud_workspaces_synced = (listener: () => void): (() => void) => {
	synced_listeners.add(listener)
	return () => synced_listeners.delete(listener)
}

let refetch_cb: (() => void) | null = null

/** Registered by the cloud store at bootstrap (it owns fetch_workspaces). */
export
const register_cloud_workspaces_refetch = (cb: () => void): void => {
	refetch_cb = cb
}

/** Board-originated workspace mutations ask for a sidebar refetch through here. */
export
const request_cloud_workspaces_refetch = (): void => {
	refetch_cb?.()
}

/** Propagates a workspace rename (e.g. cloud) into both persisted lists. */
export
const rename_in_workspaces_lists = (id: string, name: string) => {
	const rename = (list: WorkspacesList): WorkspacesList =>
		list.map(item => item.id === id ? { ...item, name } : item)
	bookmarks.value = rename(bookmarks.value)
	last_opened.value = rename(last_opened.value)
}

async function local_folder_exists(path: string): Promise<boolean> {
	const { stat } = await import('@tauri-apps/plugin-fs')
	try {
		const info = await stat(path)
		return info.isDirectory
	} catch {
		return false
	}
}

export async function filter_existing_local_workspaces(
	list: WorkspacesList,
	exists: (path: string) => Promise<boolean> = local_folder_exists,
): Promise<WorkspacesList> {
	return filter_existing_workspaces(list, { local: exists })
}

export async function filter_existing_workspaces(
	list: WorkspacesList,
	exists: {
		local?: (path: string) => Promise<boolean>
		browser?: (path: string) => Promise<boolean>
	},
): Promise<WorkspacesList> {
	const result: WorkspacesList = []
	for (const item of list) {
		const normalized = normalize_item(item)
		if (normalized.type === 'local' && exists.local && !(await exists.local(normalized.id))) {
			continue
		}
		if (normalized.type === 'browser' && exists.browser && !(await exists.browser(normalized.id))) {
			continue
		}
		result.push(normalized)
	}
	return result
}

const same_workspace_ids = (a: WorkspacesList, b: WorkspacesList): boolean => {
	if (a.length !== b.length) return false
	return a.every((item, index) => item.id === b[index]!.id)
}

/**
 * Drops workspaces whose backing folders no longer exist: local (Tauri fs)
 * on desktop, browser (IndexedDB) on the web. Cloud entries are handled by
 * sync_cloud_workspaces_list after fetch_workspaces.
 */
export async function sync_workspaces_list(): Promise<void> {
	const exists = is_desktop
		? { local: local_folder_exists }
		: { browser: browser_entry_exists }

	const [next_bookmarks, next_last_opened] = await Promise.all([
		filter_existing_workspaces(bookmarks.value, exists),
		filter_existing_workspaces(last_opened.value, exists),
	])

	if (!same_workspace_ids(bookmarks.value, next_bookmarks)) {
		bookmarks.value = next_bookmarks
	}
	if (!same_workspace_ids(last_opened.value, next_last_opened)) {
		last_opened.value = next_last_opened
	}
}

import { computed } from 'vue'
import { createFileManager } from '@pile-commander/file-manager'
import type { FolderRef } from '@/domain/Drive'
import { is_desktop } from '@/isDesktop'
import { create_window_manager } from '@/services/window/WindowManager'
import { normalize_workspace_id, path_separator } from '@/services/workspace/paths'
import { export_workspace_to_pile } from '@/services/workspace/pack'
import { pile_archive_name, run_pile_export } from './exportPile'
import store from '@/store'
import { open_bridge, type BridgeDoor } from '@/store/bridge'
import cloud from '@/store/cloud'
import type { SyncNowOptions } from '@/services/cloud/sync/syncEngine'
import { type SyncLink, sync_link_of, sync_now, sync_workspace_to_folder, synced_folder_of, take_over_link, unlink_folder } from '@/store/localSync'
import { bridge_door_for, open_share_window, type ShareWindow } from '@/store/explorer/sharePublishPanel'
import { explorer_navigation } from './navigation'
import { explorer_drives } from './drives'
import { root_folder_id } from './folder_header'

/**
 * "Share" and "Sync" in the folder header, as in the prototype. A cloud
 * folder shares its top-level folder (a cloud workspace) through the old
 * interface's dialogs. A folder on this Mac or in browser storage shares
 * itself through a cloud copy, as the old interface's "Share…" did: the copy
 * opens and the dialog follows. A drive root (~, browser storage) is neither
 * shared nor synced: it is the whole drive
 */
export type ShareItems = {
	export: boolean
	share_with: boolean
	publish: boolean
}

function is_drive_root(ref: FolderRef): boolean {
	return normalize_workspace_id(ref.folder_id) === root_folder_id(ref)
}

export function share_items(ref: FolderRef): ShareItems {
	if (ref.drive_id === 'cloud') {
		// sharing and publishing are the owner's; anyone may take a copy
		const owner = cloud.role_of(ref.root_id) === 'owner'
		return { export: true, share_with: owner, publish: owner }
	}
	const local = !is_drive_root(ref) && cloud.is_configured
	return { export: is_desktop && ref.drive_id === 'local' && !is_drive_root(ref), share_with: local, publish: local }
}

function bridge_source(ref: FolderRef, name: string) {
	return { type: ref.drive_id === 'local' ? 'local' as const : 'browser' as const, id: normalize_workspace_id(ref.folder_id), name }
}

export function copy_to_cloud(ref: FolderRef, name: string, door: BridgeDoor, share_target?: ShareWindow): void {
	open_bridge(bridge_source(ref, name), door, { origin: ref, share_target })
}

/**
 * Saves the folder as a .pile. A cloud folder exports its whole top-level
 * folder: a save dialog on desktop, a browser download on the web.
 */
export async function export_folder(ref: FolderRef, name: string): Promise<void> {
	try {
		if (ref.drive_id === 'cloud') {
			const drive = explorer_drives.drives().find(item => item.id === 'cloud')
			if (drive) await store.export_current_workspace(await drive.store_for(ref.root_id))
			return
		}
		const zip_path = await create_window_manager().save_pile_file(`${name}.pile`)
		if (!zip_path) return
		await run_pile_export(name, async (notify) => {
			notify.packing()
			await export_workspace_to_pile(createFileManager('local'), ref.folder_id, zip_path)
			return { file_name: pile_archive_name(zip_path, `${name}.pile`), path: zip_path }
		})
	} catch (error) {
		report(error)
	}
}

/**
 * Auto-sync keeps a folder on this Mac in step with a cloud copy, both ways,
 * while the app is open. A folder on this Mac links itself; a cloud folder
 * links its top-level folder to a new folder on this Mac. One link per side
 */
export function can_sync(ref: FolderRef, can_write: boolean): boolean {
	if (!is_desktop || !cloud.is_configured) return false
	if (ref.drive_id === 'cloud') return can_write
	return ref.drive_id === 'local' && !is_drive_root(ref)
}

/** The link this folder is part of: a folder on this Mac by its path, a cloud folder by its top-level folder */
export function sync_link_for(ref: FolderRef): SyncLink | null {
	return ref.drive_id === 'cloud'
		? synced_folder_of(ref.root_id)
		: sync_link_of(normalize_workspace_id(ref.folder_id))
}

/** This folder, then each parent, nearest first. `/a/b` yields `/a/b`, `/a`. */
export function folder_and_ancestors(folder_id: string): string[] {
	const sep = path_separator(folder_id)
	const paths: string[] = []
	let current = normalize_workspace_id(folder_id)
	while (current) {
		paths.push(current)
		const slash = current.lastIndexOf(sep)
		if (slash <= 0) break
		current = current.slice(0, slash)
	}
	return paths
}

/**
 * The signed-in account's sync link on this folder or a parent of it.
 * Another account's link on this device does not count.
 */
export function sync_link_covering(ref: FolderRef): SyncLink | null {
	const user_id = cloud.user?.id
	if (!user_id) return null
	if (ref.drive_id === 'cloud') return synced_folder_of(ref.root_id, user_id)
	if (ref.drive_id !== 'local') return null
	for (const path of folder_and_ancestors(ref.folder_id)) {
		const link = sync_link_of(path)
		if (link?.user_id === user_id) return link
	}
	return null
}

/**
 * Share and publish open the cloud folder when one already exists: the cloud
 * workspace itself, or the sync link of this account on this folder or a parent.
 * Otherwise the folder still has to be copied.
 */
export function open_shared_cloud(ref: FolderRef, name: string, window: ShareWindow): void {
	if (ref.drive_id === 'cloud') {
		const cloud_name = cloud.workspaces.find(ws => ws.id === ref.root_id)?.name ?? name
		open_share_window(ref.root_id, window, cloud_name)
		return
	}
	const link = sync_link_covering(ref)
	if (link) {
		open_share_window(link.workspace_id, window, link.name)
		return
	}
	copy_to_cloud(ref, name, bridge_door_for(window), window)
}

export function use_sync_link(ref: () => FolderRef) {
	return computed(() => sync_link_covering(ref()))
}

/**
 * The tree's "synced" mark: the linked folder itself. A cloud folder shows it
 * on its top-level folder only; a folder on this Mac, on the linked folder
 */
export function shows_synced(ref: FolderRef): boolean {
	if (ref.drive_id === 'cloud' && ref.folder_id !== '/') return false
	return sync_link_for(ref) !== null
}

function report(error: unknown) {
	store.last_error = error instanceof Error ? error.message : String(error)
}

export async function start_sync(ref: FolderRef, name: string): Promise<void> {
	if (ref.drive_id !== 'cloud') {
		copy_to_cloud(ref, name, 'sync')
		return
	}
	try {
		const root_name = cloud.workspaces.find(ws => ws.id === ref.root_id)?.name ?? name
		const root = await sync_workspace_to_folder({ id: ref.root_id, name: root_name })
		if (root) await explorer_navigation.open_local_path(root)
	} catch (error) {
		report(error)
	}
}

/** "Continue syncing here" for a folder another copy of the app syncs */
export async function continue_sync_here(ref: FolderRef, name: string): Promise<void> {
	try {
		await take_over_link(normalize_workspace_id(ref.folder_id), name)
	} catch (error) {
		report(error)
	}
}

export async function stop_sync(link: SyncLink): Promise<void> {
	try {
		await unlink_folder(link.root)
	} catch (error) {
		report(error)
	}
}

export async function sync_link_now(link: SyncLink, options: SyncNowOptions = {}): Promise<void> {
	try {
		await sync_now(link.root, options)
	} catch (error) {
		report(error)
	}
}

/** The other side of the link: the cloud copy from this Mac, the folder on this Mac from the cloud */
export async function open_other_side(ref: FolderRef, link: SyncLink): Promise<void> {
	try {
		if (ref.drive_id === 'cloud') await explorer_navigation.open_local_path(link.root)
		else await explorer_navigation.open_folder({ drive_id: 'cloud', root_id: link.workspace_id, folder_id: '/' })
	} catch (error) {
		report(error)
	}
}

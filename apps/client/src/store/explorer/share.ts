import { computed } from 'vue'
import { createFileManager } from '@pile-commander/file-manager'
import type { FolderRef } from '@/domain/Drive'
import { is_desktop } from '@/isDesktop'
import { create_window_manager } from '@/services/window/WindowManager'
import { normalize_workspace_id } from '@/services/workspace/paths'
import { export_workspace_to_pile } from '@/services/workspace/pack'
import store from '@/store'
import { open_bridge, type BridgeDoor } from '@/store/bridge'
import cloud from '@/store/cloud'
import type { SyncNowOptions } from '@/services/cloud/sync/syncEngine'
import { type SyncLink, sync_link_of, sync_now, sync_workspace_to_folder, synced_folder_of, unlink_folder } from '@/store/localSync'
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
		return { export: is_desktop, share_with: owner, publish: owner }
	}
	const local = !is_drive_root(ref) && cloud.is_configured
	return { export: is_desktop && ref.drive_id === 'local' && !is_drive_root(ref), share_with: local, publish: local }
}

function bridge_source(ref: FolderRef, name: string) {
	return { type: ref.drive_id === 'local' ? 'local' as const : 'browser' as const, id: normalize_workspace_id(ref.folder_id), name }
}

export function copy_to_cloud(ref: FolderRef, name: string, door: BridgeDoor): void {
	open_bridge(bridge_source(ref, name), door)
}

/** Saves the folder as a .pile: a cloud folder's whole top-level folder */
export async function export_folder(ref: FolderRef, name: string): Promise<void> {
	try {
		if (ref.drive_id === 'cloud') {
			const drive = explorer_drives.drives().find(item => item.id === 'cloud')
			if (drive) await store.export_current_workspace(await drive.store_for(ref.root_id))
			return
		}
		const zip_path = await create_window_manager().save_pile_file(`${name}.pile`)
		if (!zip_path) return
		await export_workspace_to_pile(createFileManager('local'), ref.folder_id, zip_path)
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

export function use_sync_link(ref: () => FolderRef) {
	return computed(() => sync_link_for(ref()))
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

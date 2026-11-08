import type { UntouchedExpect } from '@pile-commander/file-manager'

/** A local entry in a folder that syncs with the cloud, and the cloud row it is linked to (null: not uploaded yet) */
export type SyncedEntry = {
	root: string
	cloud_id: string | null
}

/**
 * What undo needs of the local folder sync (desktop only). A delete or a
 * creation in a synced folder is undone on both sides while the folder's
 * passes wait, so that no pass in between uploads it again or brings it back
 * down (LOCAL_SYNC.md, "Undo")
 */
export type SyncedFolders = {
	/** The synced folder holding `path` and the cloud row its entry is linked to; null outside one */
	locate(path: string): Promise<SyncedEntry | null>
	/** Runs `fn` while the folder's passes wait */
	hold<T>(root: string, fn: () => Promise<T>): Promise<T>
	/** Whether the cloud row is alive, in the trash, or gone for good */
	row_state(cloud_id: string): Promise<'live' | 'trashed' | 'gone'>
	/** The cloud row back out of the trash */
	restore_row(cloud_id: string): Promise<void>
	/** The cloud copy of a just-made entry, for good, while it holds what was made */
	remove_copy(entry: SyncedEntry, expect: UntouchedExpect): Promise<void>
}

let synced: SyncedFolders | null = null

/** The desktop sync registers itself; elsewhere there is none */
export function set_synced_folders(hooks: SyncedFolders | null): void {
	synced = hooks
}

export function synced_folders(): SyncedFolders | null {
	return synced
}

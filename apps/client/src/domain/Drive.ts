import type { WorkspaceStore } from '@/domain/Store'

/** Today's WorkspaceType; S3 or a media server becomes one more kind */
export type DriveKind = 'local' | 'browser' | 'cloud' | 'demo'

export type Drive = {
	/** 'local', 'browser', 'cloud'; later 's3:<bucket>' */
	id: string
	kind: DriveKind
	/** «Этот Mac», «Локальное хранилище браузера», «Облако» */
	name: string
	icon: string

	/**
	 * Stores owned by the drive:
	 * local — ~ plus folders opened outside it (/Volumes/…);
	 * browser — one virtual root; cloud — one per cloud workspace
	 */
	roots(): Promise<DriveRoot[]>

	/**
	 * The store that owns this root; opened on first use. Kept while the root
	 * is expanded in the tree or holds the current location, then disposed
	 */
	store_for(root_id: string): Promise<WorkspaceStore>

	/** Trash: a page in the Explorer, the system Trash (Finder), or none */
	trash: 'page' | 'system' | null
}

export type DriveRoot = {
	/** Local: home path or a folder outside it. Cloud: workspace UUID. */
	id: string
	name: string
	can_write: boolean
	/** The root folder's own view, when known before its store opens (cloud) */
	view?: string
	/** Names of its subfolders, when known before its store opens (cloud): the chevron */
	subfolders?: string[]
}

/** Address of any folder: bookmarks, history and the last location store this */
export type FolderRef = {
	drive_id: string
	root_id: string
	/**
	 * The folder id as WorkspaceStore uses it today: an absolute path
	 * locally, a path from "/" in the cloud. Not relative to the root
	 */
	folder_id: string
}

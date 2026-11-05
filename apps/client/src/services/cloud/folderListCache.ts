import type { FileManager, FolderWithChildrenXattrs } from '@pile-commander/file-manager'
import { create_device_queue } from '@/services/workspace/deviceQueue'
import { indexeddb_folder_list_disk, type FolderListDisk } from './folderListDisk'

/**
 * What the cloud last said a folder holds, kept on this device per account:
 * a folder opened before shows from here at once, and the cloud is read again
 * behind it. Only the cloud's own answers are kept — a snapshot taken the
 * moment the answer arrives, before the store lays anything over it (a look
 * still being saved, layout put back). Signed out, nothing is kept or read.
 */

let disk: FolderListDisk = indexeddb_folder_list_disk()
/**
 * A device read that has not answered by then is a miss. The cloud read runs
 * alongside anyway: this only bounds how long a hung disk is listened to
 */
let disk_wait_ms = 150
const device = create_device_queue()
/** The account whose lists are read and kept now; null while signed out */
let owner: string | null = null

/** Where lists are kept between launches (tests put one in memory, and may change the wait) */
export function set_folder_list_disk(next: FolderListDisk, options?: { wait_ms?: number }) {
	disk = next
	if (options?.wait_ms !== undefined) disk_wait_ms = options.wait_ms
}

const OWNER_KEY = 'pile_folder_lists_owner'

/**
 * The signed-in account. Another account's lists are wiped before anything
 * is read (a sign-out this window did not see, a second account in the same
 * browser)
 */
export function set_folder_list_owner(user_id: string) {
	let kept_for: string | null = null
	try {
		kept_for = localStorage.getItem(OWNER_KEY)
	} catch {
		// no storage: nothing on the device either
	}
	if (kept_for !== null && kept_for !== user_id) reset_folder_list_cache()
	owner = user_id
	try {
		localStorage.setItem(OWNER_KEY, user_id)
	} catch {
		// no storage
	}
}

/** Forget every list, on this device too (sign-out: the next account must not see them) */
export function reset_folder_list_cache(): Promise<void> {
	owner = null
	const target = disk
	return device.wipe(() => target.clear())
}

function key_of(user: string, workspace_id: string, folder_id: string) {
	return `${user}\0${workspace_id}\0${folder_id}`
}

/** Keeps a snapshot of the cloud's answer; the caller may change its own copy freely */
export function remember_folder_list(workspace_id: string, folder_id: string, list: FolderWithChildrenXattrs) {
	if (!owner) return
	const snapshot = structuredClone(list)
	const key = key_of(owner, workspace_id, folder_id)
	const target = disk
	void device.write(device.epoch(), () => target.put(key, snapshot))
}

/** The list kept for this folder, or null (none, signed out, wiped meanwhile, or the disk is slow) */
export async function recall_folder_list(workspace_id: string, folder_id: string): Promise<FolderWithChildrenXattrs | null> {
	if (!owner) return null
	const started_in = device.epoch()
	const key = key_of(owner, workspace_id, folder_id)
	const list = await new Promise<FolderWithChildrenXattrs | null>((resolve) => {
		const timer = setTimeout(() => resolve(null), disk_wait_ms)
		disk.get(key).then(
			(value) => { clearTimeout(timer); resolve(value) },
			() => { clearTimeout(timer); resolve(null) },
		)
	})
	return started_in === device.epoch() ? list : null
}

/**
 * Every folder read of this cloud file manager keeps its answer on the
 * device. One place for all of them (opening, a refresh, previews, the
 * tree), each cloned as it arrives
 */
export function keep_folder_lists(fm: FileManager, workspace_id: string): FileManager {
	const read = fm.folder_with_children_xattrs.bind(fm)
	fm.folder_with_children_xattrs = async (folder_id: string) => {
		const list = await read(folder_id)
		remember_folder_list(workspace_id, folder_id, list)
		return list
	}
	return fm
}

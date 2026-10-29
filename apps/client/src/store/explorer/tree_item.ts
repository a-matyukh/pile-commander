import { reactive } from 'vue'
import type { FolderRef } from '@/domain/Drive'
import { explorer_drives } from './drives'
import { explorer_tree, type ExplorerTreeRoot } from './tree'

/** Roots made for folders the tree does not list, kept so their store stays theirs */
const made = new Map<string, ExplorerTreeRoot>()

/**
 * A folder's root, as the folder menus act on it. The tree lists the roots
 * of its drive only while the sidebar is open; with it closed (or the folder
 * on another drive) the root comes from the drive itself, its store opened
 * on first use, as the tree's would be
 */
export function tree_item_for(ref: FolderRef): ExplorerTreeRoot | null {
	const listed = explorer_tree.roots.find(root => root.drive.id === ref.drive_id && root.root.id === ref.root_id)
	if (listed) return listed
	const drive = explorer_drives.drive(ref.drive_id)
	if (!drive) return null
	const key = `${ref.drive_id}\n${ref.root_id}`
	let item = made.get(key)
	if (!item || item.drive !== drive) {
		item = reactive({ drive, root: { id: ref.root_id, name: '', can_write: true }, workspace: null, loading: false }) as ExplorerTreeRoot
		made.set(key, item)
	}
	return item
}

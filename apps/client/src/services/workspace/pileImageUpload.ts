import { reactive } from 'vue'
import type { PileImageRole } from '@pile-commander/file-manager'

/** How many uploads of this folder and role are in flight (encode, upload, then the xattr write). */
const counts = reactive<Record<string, number>>({})

/**
 * Per workspace: every cloud root is `/`, so a key by path alone marked
 * every root as uploading when one root's cover was
 */
function key(workspace_id: string, folder_id: string, role: PileImageRole): string {
	return `${workspace_id}\0${folder_id}\0${role}`
}

export function begin_pile_image(workspace_id: string, folder_id: string, role: PileImageRole) {
	const id = key(workspace_id, folder_id, role)
	counts[id] = (counts[id] ?? 0) + 1
}

export function end_pile_image(workspace_id: string, folder_id: string, role: PileImageRole) {
	const id = key(workspace_id, folder_id, role)
	const next = (counts[id] ?? 0) - 1
	if (next <= 0) delete counts[id]
	else counts[id] = next
}

export function pile_image_busy(workspace_id: string, folder_id: string, role: PileImageRole): boolean {
	return (counts[key(workspace_id, folder_id, role)] ?? 0) > 0
}

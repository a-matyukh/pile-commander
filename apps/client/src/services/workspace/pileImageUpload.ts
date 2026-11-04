import { reactive } from 'vue'
import type { PileImageRole } from '@pile-commander/file-manager'

/** How many uploads of this folder and role are in flight (encode, upload, then the xattr write). */
const counts = reactive<Record<string, number>>({})

function key(folder_id: string, role: PileImageRole): string {
	return `${folder_id}\0${role}`
}

export function begin_pile_image(folder_id: string, role: PileImageRole) {
	const id = key(folder_id, role)
	counts[id] = (counts[id] ?? 0) + 1
}

export function end_pile_image(folder_id: string, role: PileImageRole) {
	const id = key(folder_id, role)
	const next = (counts[id] ?? 0) - 1
	if (next <= 0) delete counts[id]
	else counts[id] = next
}

export function pile_image_busy(folder_id: string, role: PileImageRole): boolean {
	return (counts[key(folder_id, role)] ?? 0) > 0
}

import { reactive } from 'vue'
import type { PileImageRole } from '@pile-commander/file-manager'

/** How many uploads of this folder and role are in flight (encode, upload, then the xattr write). */
const counts = reactive<Record<string, number>>({})
const seeds = new Map<string, () => void>()

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

/** Keep the seeded blob until the xattr write has had a chance to be displayed. */
export function hold_pile_image_seed(folder_id: string, role: PileImageRole, release: () => void) {
	const id = key(folder_id, role)
	const previous = seeds.get(id)
	seeds.set(id, release)
	previous?.()
}

/**
 * Call after the xattr is stored (or the write failed). A view that already
 * shows the picture keeps the blob; one nobody took is revoked on the next turn,
 * after the watch that displays it has claimed its ref.
 */
export function settle_pile_image_seed(folder_id: string, role: PileImageRole) {
	const id = key(folder_id, role)
	const release = seeds.get(id)
	seeds.delete(id)
	if (!release) return
	setTimeout(release, 0)
}

import type { FolderRef } from '@/domain/Drive'
import { normalize_workspace_id } from '@/services/workspace/paths'
import { is_within } from '@/store/explorer/drives'

export type DropPoint = { x: number, y: number }

export type DropRect = { left: number, top: number, right: number, bottom: number }

/** True when an OS drop landed inside the top bar. An unknown point does not. */
export function point_in_rect(point: DropPoint | null, rect: DropRect | null): boolean {
	if (!point || !rect) return false
	return point.x >= rect.left && point.x <= rect.right
		&& point.y >= rect.top && point.y <= rect.bottom
}

/** A dropped folder under ~ belongs to the home root. Anything else is its own local root. */
export function local_bookmark_ref(path: string, home: string): FolderRef {
	const id = normalize_workspace_id(path)
	const root = normalize_workspace_id(home)
	const root_id = is_within(id, root) ? root : id
	return { drive_id: 'local', root_id, folder_id: id }
}

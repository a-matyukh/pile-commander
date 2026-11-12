import type { WorkspaceStore } from '@/domain/Store'
import type { Position } from '@/domain/Widget'
import { board_position, relative_to_origin, TILE } from '@/services/board/layout'
import { resolve_unique_filename } from '@/services/naming/uniqueName'
import { to_folder_container } from '@/services/workspace/folderContainer'
import type { HistoryTx } from '@/store/history/types'

/**
 * Writes a sorting plan the person confirmed: new folders where their items
 * stood on the board, existing ones as they are, then the moves. With `tx`
 * the whole plan is one undo; the history takes the moves out of a new
 * folder before it removes the folder.
 */

export type SortGroupPlan = {
	/** A new folder's name, or the existing folder's own. */
	name: string
	/** The folder already in place, or null for one to make. */
	existing_id: string | null
	/** What goes into it, by id. */
	entry_ids: string[]
}

export type SortFolderOutcome =
	| { id: string; name: string; created: boolean }
	| { error: string }

export type SortWriteOutcome = {
	/** By group, in the plan's order. */
	folders: SortFolderOutcome[]
	/** By entry id: its new id, or why it did not move. */
	moved: Map<string, { id: string } | { error: string }>
}

type SortWrites = Pick<WorkspaceStore,
	| 'create_folder'
	| 'rename'
	| 'move'
	| 'change_position'
	| 'resolve_folder_data'
	| 'preview_folders'
	| 'run_batch_fs_update'
	| 'reload_folder_cache'
	| 'ensure_preview_folder'>

function message_of(error: unknown): string {
	return error instanceof Error ? error.message : String(error)
}

/** The top-left corner of what is placed, so every item keeps a place inside. */
function corner(positions: Position[]): Position | null {
	if (!positions.length) return null
	return {
		x: Math.min(...positions.map(spot => spot.x)),
		y: Math.min(...positions.map(spot => spot.y)),
	}
}

export async function apply_sort_plan(
	workspace: SortWrites,
	folder_id: string,
	groups: readonly SortGroupPlan[],
	tx?: HistoryTx,
): Promise<SortWriteOutcome> {
	return workspace.run_batch_fs_update(async () => {
		const folder = workspace.resolve_folder_data(folder_id)
		const container = folder ? to_folder_container(folder, workspace.preview_folders) : null
		const children = container?.children ?? []
		const index_of = new Map(children.map((child, index) => [child.id, index]))
		const widget_of = new Map(children.map(child => [child.id, child]))
		// A board keeps its places: a new folder stands where its items stood, and they keep their layout inside
		const placed = children.some(child => !!child.position)
		const spot_of = (id: string): Position | null => {
			const widget = widget_of.get(id)
			return placed && widget ? board_position(widget, index_of.get(id) ?? 0) : null
		}

		const outcome: SortWriteOutcome = { folders: groups.map(() => ({ error: '' })), moved: new Map() }
		const targets: (string | null)[] = groups.map(() => null)
		const origins: (Position | null)[] = groups.map(() => null)

		// Every new folder is made before any is named, so each has a "New folder N" id of its own
		for (const [index, group] of groups.entries()) {
			if (group.existing_id) {
				targets[index] = group.existing_id
				outcome.folders[index] = { id: group.existing_id, name: group.name, created: false }
				continue
			}
			origins[index] = corner(group.entry_ids.map(spot_of).filter((spot): spot is Position => !!spot))
			try {
				const id = await workspace.create_folder(folder_id, origins[index] ?? undefined, { view: container?.view, tx })
				if (!id) throw new Error('The folder could not be created')
				targets[index] = id
			} catch (error) {
				outcome.folders[index] = { error: message_of(error) }
			}
		}
		for (const [index, group] of groups.entries()) {
			const id = targets[index]
			if (!id || group.existing_id) continue
			const siblings = (workspace.resolve_folder_data(folder_id)?.children ?? [])
				.filter(child => child.id !== id)
				.map(child => child.name)
			const wanted = resolve_unique_filename(group.name, siblings, { ignore_case: true })
			try {
				const renamed = (await workspace.rename(id, wanted, { report: false, tx })) ?? id
				targets[index] = renamed
				outcome.folders[index] = { id: renamed, name: wanted, created: true }
			} catch {
				// The folder is there under its "New folder N" name: the items still go in
				const name = workspace.resolve_folder_data(folder_id)?.children?.find(child => child.id === id)?.name ?? group.name
				outcome.folders[index] = { id, name, created: true }
			}
		}

		for (const [index, group] of groups.entries()) {
			const target = targets[index]
			if (!target) {
				const error = 'error' in outcome.folders[index]! ? (outcome.folders[index] as { error: string }).error : 'No folder'
				for (const entry_id of group.entry_ids) outcome.moved.set(entry_id, { error: error || 'No folder' })
				continue
			}
			if (group.existing_id) await workspace.ensure_preview_folder(target)
			const start = group.existing_id ? (workspace.resolve_folder_data(target)?.children?.length ?? 0) : 0
			const origin = origins[index]
			for (const [at, entry_id] of group.entry_ids.entries()) {
				const spot = spot_of(entry_id)
				try {
					const moved = await workspace.move(entry_id, target, start + at, folder_id, undefined, { tx })
					if (!moved) throw new Error('Not moved')
					if (origin && spot) {
						await workspace.change_position(moved, relative_to_origin(spot, origin, { x: TILE.pad, y: TILE.pad }), { tx })
					}
					outcome.moved.set(entry_id, { id: moved })
				} catch (error) {
					outcome.moved.set(entry_id, { error: message_of(error) })
				}
			}
		}

		// One reload at the end: watchers are paused during the batch
		await workspace.reload_folder_cache(folder_id)
		for (const target of new Set(targets.filter((id): id is string => !!id))) {
			await workspace.reload_folder_cache(target)
		}
		return outcome
	})
}

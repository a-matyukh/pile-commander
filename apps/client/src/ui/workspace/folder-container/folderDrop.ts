import type { Xattr } from '@pile-commander/file-manager'
import type { Position } from '@/domain/Widget'
import type { WorkspaceStore } from '@/domain/Store'
import { board_drop_positions, read_position_attr } from '@/services/board/layout'
import { path_separator } from '@/services/workspace/paths'
import { xattrs_map } from '@/services/workspace/xattrs'

export type FolderDropOptions = {
	/** Window-scoped workspace getter, captured at setup (handlers can't inject). */
	getWorkspace: () => WorkspaceStore
	resolveRelativePosition: (
		dragged: HTMLElement,
		folder: HTMLElement,
		widgetId: string,
	) => Position | null
	onDropSuccess?: (widgetId: string) => void
}

/** Duck-typed so the helper can be unit-tested in node without a DOM. */
export type ContainsHost = {
	contains(node: unknown): boolean
}

/**
 * Drop targets are sibling folder widgets on the same board — not nested
 * covers inside the dragged preview, and not folders inside a neighbor preview.
 */
export function isSameBoardFolderDropTarget(
	dragged: ContainsHost,
	folder: ContainsHost,
	dragBoard: unknown,
	folderBoard: unknown,
): boolean {
	if (folder === dragged) return false
	if (folder.contains(dragged) || dragged.contains(folder)) return false
	return folderBoard === dragBoard
}

export function findDropFolder(dragged: HTMLElement): HTMLElement | null {
	const rect = dragged.getBoundingClientRect()
	const centerX = rect.left + rect.width / 2
	const centerY = rect.top + rect.height / 2
	const scope = dragged.closest<HTMLElement>('section[data-path]')
	if (!scope) return null

	for (const folder of scope.querySelectorAll<HTMLElement>('.board-widget.container')) {
		const folderBoard = folder.closest<HTMLElement>('section[data-path]')
		if (!isSameBoardFolderDropTarget(dragged, folder, scope, folderBoard)) continue
		const folderRect = folder.getBoundingClientRect()
		if (
			centerX >= folderRect.left
			&& centerX <= folderRect.right
			&& centerY >= folderRect.top
			&& centerY <= folderRect.bottom
		) {
			return folder
		}
	}
	return null
}

function resolve_source_folder_id(dragged: HTMLElement): string | null {
	const section = dragged.closest<HTMLElement>('section[data-path]')
	return section?.dataset.path ?? null
}

/** Drop target must not move into itself or into its own descendant. */
export function droppableWidgetIds(
	widgetIds: string[],
	targetFolderId: string,
): string[] {
	return widgetIds.filter((id) => {
		if (id === targetFolderId) return false
		return !targetFolderId.startsWith(id + path_separator(id))
	})
}

type DropPlan = {
	widgetId: string
	/** Persist after the move. Null leaves the existing position xattr alone. */
	position: Position | null
}

function read_folder_view(xattrs: Xattr[] | undefined): string | undefined {
	if (!xattrs) return undefined
	const view = xattrs_map(xattrs).view
	return typeof view === 'string' ? view : undefined
}

function same_position(a: Position, b: Position): boolean {
	return a.x === b.x && a.y === b.y
}

/**
 * Drop one or more widgets onto a folder under the primary dragged element.
 *
 * - FolderPreview (`folder-preview-widget`): rewrite position to coords relative
 *   to the preview so a multi-drag keeps layout inside the open board.
 * - folder_cover: leave the pre-drag position xattr alone (same as cut/paste),
 *   unless this is a canvas → board drop and a landing coordinate is negative.
 *   That group is shifted together into the board's visible quadrant.
 */
export async function tryDropOnFolder(
	dragged: HTMLElement,
	widgetIdOrIds: string | string[],
	options: FolderDropOptions,
): Promise<boolean> {
	const folder = findDropFolder(dragged)
	if (!folder) return false

	const ws = options.getWorkspace()
	if (!ws.can_write) return false

	const targetFolderId = folder.dataset.id
	if (!targetFolderId) return false

	const sourceFolderId = resolve_source_folder_id(dragged)
	if (!sourceFolderId) return false

	const ids = droppableWidgetIds(
		Array.isArray(widgetIdOrIds) ? widgetIdOrIds : [widgetIdOrIds],
		targetFolderId,
	)
	if (ids.length === 0) return false

	const isFolderPreview = folder.classList.contains('folder-preview-widget')
	const sourceFolder = ws.resolve_folder_data(sourceFolderId)
	if (!sourceFolder) return false

	// View lives on the folder entry. A loaded folder record is the copy
	// change_folder_view writes; a closed cover only has the child row here.
	const sourceView = read_folder_view(sourceFolder.xattrs)
	const targetEntry = sourceFolder.children?.find(child => child.id === targetFolderId)
	const targetRecord = ws.resolve_folder_data(targetFolderId)
	const targetView = targetRecord
		? read_folder_view(targetRecord.xattrs)
		: read_folder_view(targetEntry?.xattrs)

	// Resolve every landing position before any await — move/change_position
	// can clear live drag state that resolveRelativePosition reads.
	const drafts: Array<{
		widgetId: string
		landing: Position | null
		rewrite: boolean
	}> = []
	for (const widgetId of ids) {
		const child = sourceFolder.children?.find(entry => entry.id === widgetId)
		if (!child) continue

		if (isFolderPreview) {
			const relative = options.resolveRelativePosition(dragged, folder, widgetId)
			if (!relative) continue
			drafts.push({ widgetId, landing: relative, rewrite: true })
			continue
		}

		const stored = read_position_attr(xattrs_map(child.xattrs).position) ?? null
		drafts.push({ widgetId, landing: stored, rewrite: false })
	}
	if (drafts.length === 0) return false

	const shifted = board_drop_positions(
		sourceView,
		targetView,
		drafts.map(draft => draft.landing),
	)
	const plans: DropPlan[] = drafts.map((draft, index) => {
		const next = shifted[index] ?? null
		if (draft.rewrite) return { widgetId: draft.widgetId, position: next }
		if (!next || !draft.landing || same_position(next, draft.landing)) {
			return { widgetId: draft.widgetId, position: null }
		}
		return { widgetId: draft.widgetId, position: next }
	})

	const applyPlans = async (): Promise<boolean> => {
		let movedAny = false
		for (const plan of plans) {
			const newWidgetId = await ws.move(
				plan.widgetId,
				targetFolderId,
				0,
				sourceFolderId,
			)
			if (!newWidgetId) continue

			if (plan.position) {
				await ws.change_position(newWidgetId, plan.position)
			}
			options.onDropSuccess?.(plan.widgetId)
			movedAny = true
		}
		return movedAny
	}

	// Multi-entry drops that rewrite position need watch suppression so a
	// mid-loop refresh cannot reload the old xattrs over the rewrite.
	const writesPosition = plans.some(plan => plan.position !== null)
	const movedAny = plans.length > 1 && writesPosition
		? await ws.run_batch_fs_update(async () => {
			const moved = await applyPlans()
			if (moved) {
				await ws.reload_folder_cache(targetFolderId)
				await ws.reload_folder_cache(sourceFolderId)
			}
			return moved
		})
		: await applyPlans()

	if (movedAny) {
		if (ws.selection_mode) {
			ws.exit_selection_mode()
		} else if (ids.length > 1) {
			// Paths change on move — stale multi-selection would point at missing ids.
			ws.clear_selection()
		}
	}

	return movedAny
}

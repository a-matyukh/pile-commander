import { reactive } from 'vue'
import type { FolderContainerWidget } from '@/domain/Widget'

/**
 * Slide a read-only viewer is looking at. Not written to the folder: that
 * attribute is the author's saved slide, and a viewer cannot change it.
 * Keyed by workspace uid — cloud stores all have id "/", so two publications
 * would otherwise share a folder path.
 */
const local_slide_index = reactive<Record<string, number>>({})

export type SlideIndexScope = {
	workspace_id: string
	folder_id: string
}

function slide_key(scope: SlideIndexScope): string {
	return `${scope.workspace_id}\0${scope.folder_id}`
}

/** Passed into `resolve_slide_index` only while the workspace is read-only. */
export function viewer_slide_scope(
	workspace: { uid: string, can_write: boolean } | null | undefined,
	folder_id: string,
): SlideIndexScope | undefined {
	if (!workspace || workspace.can_write !== false) return undefined
	return { workspace_id: workspace.uid, folder_id }
}

export function set_local_slide_index(workspace_id: string, folder_id: string, index: number): void {
	local_slide_index[slide_key({ workspace_id, folder_id })] = index
}

export function resolve_slide_index(
	container: FolderContainerWidget | null | undefined,
	scope?: SlideIndexScope,
): number {
	if (!container) return 0
	const count = container.children.length
	if (count === 0) return 0
	const local = scope ? local_slide_index[slide_key(scope)] : undefined
	const raw = local ?? container.selected_slide_index ?? 0
	return Math.min(Math.max(0, raw), count - 1)
}

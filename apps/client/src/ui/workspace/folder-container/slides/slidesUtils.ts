import type { FolderContainerWidget } from '@/domain/Widget'

export function resolve_slide_index(
	container: FolderContainerWidget | null | undefined,
): number {
	if (!container) return 0
	const count = container.children.length
	if (count === 0) return 0
	const raw = container.selected_slide_index ?? 0
	return Math.min(Math.max(0, raw), count - 1)
}

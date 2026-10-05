import type { FolderView } from '@/domain/Widget'

/**
 * True when widgets should use canvas (Vue Flow node) layout instead of board
 * absolute positioning. Embedded board folder previews inside a canvas folder
 * still render via Board.vue and must keep board layout for correct sizes.
 */
export function resolveIsCanvasWidgetLayout(
	layoutMode: 'board' | 'canvas',
	isEmbedded: boolean,
	view: FolderView | undefined,
): boolean {
	if (layoutMode !== 'canvas') return false
	if (isEmbedded && view === 'board') return false
	return true
}

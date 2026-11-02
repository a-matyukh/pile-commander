import type { FolderContainerWidgetChild } from '@/domain/Widget'
import { image_shows_preview } from '@/services/board/layout'

/** Preview files (notes, media) can set `background`. Shapes use fill instead. */
export function canHaveWidgetBackground(widget: FolderContainerWidgetChild): boolean {
	if (widget.type !== 'file' || widget.name.endsWith('.svg')) return false
	return image_shows_preview(widget) || widget.is_preview === true
}

/** Shared Background menu: every selected pane child must support a background. */
export function selectionCanSetSharedBackground(
	widgets: readonly FolderContainerWidgetChild[],
): boolean {
	return widgets.length > 1 && widgets.every(canHaveWidgetBackground)
}

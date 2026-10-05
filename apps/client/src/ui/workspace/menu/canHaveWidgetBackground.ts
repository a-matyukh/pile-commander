import type { FolderContainerWidgetChild } from '@/domain/Widget'

/** Preview files (notes, media) can set `background`. Shapes use fill instead. */
export function canHaveWidgetBackground(widget: FolderContainerWidgetChild): boolean {
	return widget.type === 'file'
		&& widget.is_preview === true
		&& !widget.name.endsWith('.svg')
}

/** Shared Background menu: every selected pane child must support a background. */
export function selectionCanSetSharedBackground(
	widgets: readonly FolderContainerWidgetChild[],
): boolean {
	return widgets.length > 1 && widgets.every(canHaveWidgetBackground)
}

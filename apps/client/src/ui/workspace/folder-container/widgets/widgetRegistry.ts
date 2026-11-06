import type { FolderContainerWidgetChild } from '@/domain/Widget'
import {
	is_audio_widget,
	is_folder_preview_widget,
	is_image_widget,
	is_model_widget,
	is_note_widget,
	is_shape_widget,
	is_text_widget,
	is_video_widget,
} from '@/services/board/layout'
import type { PreviewKind } from './previewKinds'

/**
 * `text` is a note file drawn as a bare text block on the board and canvas.
 * Views that do not draw it (stack, slides, dashboard, masonry) treat it as a
 * `note`, so a check for notes there must accept both roles.
 */
export type WidgetRole = 'text' | 'note' | PreviewKind | 'folder_preview' | 'default'

export function resolveWidgetRole(widget: FolderContainerWidgetChild): WidgetRole {
	if (is_text_widget(widget)) return 'text'
	if (is_note_widget(widget)) return 'note'
	if (is_image_widget(widget)) return 'image'
	if (is_video_widget(widget)) return 'video'
	if (is_audio_widget(widget)) return 'audio'
	if (is_model_widget(widget)) return 'model'
	if (is_shape_widget(widget)) return 'shape'
	if (is_folder_preview_widget(widget)) return 'folder_preview'
	return 'default'
}

export function resolvePreviewKind(widget: FolderContainerWidgetChild): PreviewKind | null {
	const role = resolveWidgetRole(widget)
	if (
		role === 'image'
		|| role === 'video'
		|| role === 'audio'
		|| role === 'model'
		|| role === 'shape'
	) {
		return role
	}
	return null
}

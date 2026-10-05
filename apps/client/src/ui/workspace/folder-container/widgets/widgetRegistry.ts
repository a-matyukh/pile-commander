import type { FolderContainerWidgetChild } from '@/domain/Widget'
import {
	is_audio_widget,
	is_folder_preview_widget,
	is_image_widget,
	is_model_widget,
	is_note_widget,
	is_shape_widget,
	is_video_widget,
} from '@/services/board/layout'
import type { PreviewKind } from './previewKinds'

export type WidgetRole = 'note' | PreviewKind | 'folder_preview' | 'default'

export function resolveWidgetRole(widget: FolderContainerWidgetChild): WidgetRole {
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

import type { FolderView } from '@/domain/Widget'

export const IMAGE_TEXT_FIELDS = ['title', 'description'] as const
export type ImageTextField = (typeof IMAGE_TEXT_FIELDS)[number]

const IMAGE_CAPTION_VIEWS = new Set<FolderView>([
	'board',
	'canvas',
	'dashboard',
	'masonry',
	'slides',
])

export function image_caption_in_view(view: FolderView | undefined): boolean {
	return view !== undefined && IMAGE_CAPTION_VIEWS.has(view)
}

/**
 * `parse_xattr_value` turns "2024" into a number and "true" into a boolean.
 * A caption is still that text. Objects and arrays are not captions.
 */
export function image_text_from_stored(value: unknown): string | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) return String(value)
	if (typeof value === 'boolean') return String(value)
	if (typeof value !== 'string') return undefined
	const trimmed = value.trim()
	return trimmed === '' ? undefined : trimmed
}

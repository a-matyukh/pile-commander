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

/** Where an `object-fit: contain` image is painted inside its box. */
export function contained_image_box(
	box: { width: number; height: number },
	natural: { width: number; height: number },
): { top: number; left: number; width: number; height: number } | null {
	if (box.width <= 0 || box.height <= 0 || natural.width <= 0 || natural.height <= 0) return null
	const scale = Math.min(box.width / natural.width, box.height / natural.height)
	const width = natural.width * scale
	const height = natural.height * scale
	return {
		top: (box.height - height) / 2,
		left: (box.width - width) / 2,
		width,
		height,
	}
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

export type MediaKind = 'image' | 'video' | 'audio' | 'model'

const IMAGE_EXTENSIONS = new Set([
	'.png',
	'.jpg',
	'.jpeg',
	'.gif',
	'.webp',
	'.bmp',
	'.avif',
])

const VIDEO_EXTENSIONS = new Set([
	'.mp4',
	'.webm',
	'.mov',
	'.mkv',
	'.ogv',
])

const AUDIO_EXTENSIONS = new Set([
	'.mp3',
	'.wav',
	'.ogg',
	'.flac',
	'.m4a',
	'.aac',
])

const MODEL_EXTENSIONS = new Set([
	'.glb',
	'.gltf',
])

const MIME_BY_EXTENSION: Record<string, string> = {
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.gif': 'image/gif',
	'.webp': 'image/webp',
	'.bmp': 'image/bmp',
	'.avif': 'image/avif',
	'.mp4': 'video/mp4',
	'.webm': 'video/webm',
	'.mov': 'video/quicktime',
	'.mkv': 'video/x-matroska',
	'.ogv': 'video/ogg',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg',
	'.flac': 'audio/flac',
	'.m4a': 'audio/mp4',
	'.aac': 'audio/aac',
	'.glb': 'model/gltf-binary',
	'.gltf': 'model/gltf+json',
}

export function get_file_extension(name: string): string {
	const dot = name.lastIndexOf('.')
	if (dot <= 0) return ''
	return name.slice(dot).toLowerCase()
}

export function get_media_kind(name: string): MediaKind | null {
	const ext = get_file_extension(name)
	if (IMAGE_EXTENSIONS.has(ext)) return 'image'
	if (VIDEO_EXTENSIONS.has(ext)) return 'video'
	if (AUDIO_EXTENSIONS.has(ext)) return 'audio'
	if (MODEL_EXTENSIONS.has(ext)) return 'model'
	return null
}

export function get_mime_type(name: string): string {
	const ext = get_file_extension(name)
	return MIME_BY_EXTENSION[ext] ?? 'application/octet-stream'
}

export function is_previewable_file(name: string): boolean {
	if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.svg')) return true
	return get_media_kind(name) !== null
}

/** A `.md` / `.txt` file: the only kind a note or a text block can be. */
export function is_note_file_name(name: string): boolean {
	return name.endsWith('.txt') || name.endsWith('.md')
}

/**
 * `is_text`: the file is marked as a text block (kept while its preview is
 * off), so the toggle is a round trip between the block and the file card.
 */
export function get_preview_toggle_label(name: string, is_preview: boolean, is_text = false): string {
	if (name.endsWith('.svg')) {
		return is_preview ? 'Show as file' : 'Show as shape'
	}
	if (is_note_file_name(name)) {
		if (is_text) return is_preview ? 'Show as file' : 'Show as text'
		return is_preview ? 'Hide preview' : 'Preview'
	}
	if (get_media_kind(name)) {
		return is_preview ? 'Show as file' : 'Preview'
	}
	return is_preview ? 'Hide preview' : 'Preview'
}

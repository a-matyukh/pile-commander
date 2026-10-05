import type { MediaVariant } from '@pile-commander/file-manager'

export type PreviewMediaKind = 'image' | 'video' | 'audio'
export type PreviewElement = 'img' | 'video' | 'audio'

/**
 * The element a media widget renders. A public-board visitor may be served a
 * poster instead of a video — a still image: binding it to <video> would show
 * a broken player, so it renders as <img>. Play stays with the board's
 * members, who always get the original
 */
export function preview_element(kind: PreviewMediaKind, variant: MediaVariant): PreviewElement {
	if (kind === 'image') return 'img'
	if (kind === 'video' && variant === 'poster') return 'img'
	return kind
}

/** a poster carries a play mark so it still reads as a video */
export function show_play_badge(kind: PreviewMediaKind, variant: MediaVariant): boolean {
	return kind === 'video' && variant === 'poster'
}

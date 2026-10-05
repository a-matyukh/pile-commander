import type { FolderContainerWidgetChild } from '@/domain/Widget'

/** Shell fill: folder_cover uses cover only; files prefer background then cover. */
export function resolveShellFill(widget: FolderContainerWidgetChild): string | undefined {
	if (widget.type === 'folder_cover') {
		const cover = widget.cover
		return cover && cover !== 'none' ? cover : undefined
	}

	const bg = widget.background
	if (bg && bg !== 'none') return bg

	if (widget.type === 'file') {
		const cover = widget.cover
		if (cover && cover !== 'none') return cover
	}

	return undefined
}

export function resolveWidgetBackground(
	bg: string | undefined,
	fallback = 'white',
): string {
	if (!bg || bg === 'none') return fallback
	return bg
}

const IMAGE_BACKGROUND_RE = /^(data:|https?:|file:)/

export function isImageBackground(bg: string | undefined): boolean {
	return Boolean(bg && IMAGE_BACKGROUND_RE.test(bg))
}

/** Embedded `data:` images (base64) are too large for xattrs — reject on write. */
export function isEmbeddedDataUrl(value: string): boolean {
	return /^data:/i.test(value.trim())
}

/** CSS fill for a stored background: a color, or a cover image URL. */
export function backgroundStyle(
	bg: string | undefined,
	fallback?: string,
): Record<string, string> {
	if (!bg || bg === 'none') {
		return fallback === undefined ? {} : { backgroundColor: fallback }
	}
	if (isImageBackground(bg)) {
		return {
			backgroundImage: `url("${bg}")`,
			backgroundSize: 'cover',
			backgroundPosition: 'center',
		}
	}
	return { backgroundColor: bg }
}

/** True for unset/none backgrounds and explicit white / #fff / #ffffff. */
export function isWhiteBackground(bg: string | undefined): boolean {
	if (!bg || bg === 'none') return true
	const normalized = bg.trim().toLowerCase()
	return normalized === 'white' || normalized === '#fff' || normalized === '#ffffff'
}

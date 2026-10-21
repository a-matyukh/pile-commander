import type { MediaSrc } from '@pile-commander/file-manager'

/** Longest side of an image sent to a model; plenty to name or describe it. */
export const AI_IMAGE_MAX_SIDE = 512
const JPEG_QUALITY = 0.85

export function fit_within(width: number, height: number, max_side = AI_IMAGE_MAX_SIDE): { width: number; height: number } {
	const scale = Math.min(1, max_side / Math.max(width, height, 1))
	return {
		width: Math.max(1, Math.round(width * scale)),
		height: Math.max(1, Math.round(height * scale)),
	}
}

async function blob_to_data_url(blob: Blob): Promise<string> {
	const bytes = new Uint8Array(await blob.arrayBuffer())
	let binary = ''
	for (let at = 0; at < bytes.length; at += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000))
	}
	return `data:${blob.type || 'image/jpeg'};base64,${btoa(binary)}`
}

/**
 * The bytes go through a blob URL, not the media URL itself: a cross-origin
 * presigned URL would taint the canvas and block the export.
 */
function load_image(blob: Blob): Promise<HTMLImageElement> {
	const url = URL.createObjectURL(blob)
	return new Promise<HTMLImageElement>((resolve, reject) => {
		const image = new Image()
		image.onload = () => resolve(image)
		image.onerror = () => reject(new Error('the image cannot be decoded'))
		image.src = url
	}).finally(() => URL.revokeObjectURL(url))
}

/**
 * Draws the loaded image reduced onto a canvas. An <img> already carries
 * its EXIF orientation (`naturalWidth`/`Height` and `drawImage` both use
 * it), so phone photos come out upright, from one decode.
 */
function encode_jpeg(image: HTMLImageElement): Promise<Blob> {
	const { width, height } = fit_within(image.naturalWidth, image.naturalHeight)
	const canvas = document.createElement('canvas')
	canvas.width = width
	canvas.height = height
	const context = canvas.getContext('2d')
	if (!context) return Promise.reject(new Error('no 2d canvas'))
	// jpeg has no alpha: transparent pixels would turn black
	context.fillStyle = '#fff'
	context.fillRect(0, 0, width, height)
	context.imageSmoothingQuality = 'high'
	context.drawImage(image, 0, 0, width, height)
	return new Promise((resolve, reject) => {
		canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('jpeg encoding failed'))), 'image/jpeg', JPEG_QUALITY)
	})
}

/**
 * The image as a small jpeg `data:` URL for an `image_url` part. Local
 * folders have no thumbnails, so it is always reduced here. Null when the
 * webview cannot decode the format (RAW, HEIC outside macOS); the caller
 * reports that file as skipped.
 */
export async function image_to_data_url(
	workspace: { get_media_src(id: string, filename: string): Promise<MediaSrc> },
	id: string,
	name: string,
): Promise<string | null> {
	const media = await workspace.get_media_src(id, name)
	try {
		const response = await fetch(media.url)
		if (!response.ok) return null
		const image = await load_image(await response.blob())
		return await blob_to_data_url(await encode_jpeg(image))
	} catch {
		return null
	} finally {
		media.revoke?.()
	}
}

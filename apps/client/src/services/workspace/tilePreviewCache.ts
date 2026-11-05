import { device_epoch, keep_device_bytes, recall_device_bytes } from './pileImageCache'

/**
 * Image previews of cloud files kept on this device, so a tile shows at once
 * after a restart. A preview's object key never changes (new bytes are a new
 * object), so the bytes are kept by that key and never go stale; a second
 * row remembers which object a file's tile showed last. A tile shows that at
 * once and checks it against the presigned URL it asks for anyway: the same
 * object, nothing is downloaded; another one, the new preview replaces it.
 * Same disk, limit and account rules as covers (`pileImageCache.ts`).
 */

const encoder = new TextEncoder()
const decoder = new TextDecoder()

function shown_key(workspace_id: string, file_id: string) {
	return `tile-preview\0${workspace_id}\0${file_id}`
}

function bytes_key(object_path: string) {
	return `tile-preview-object\0${object_path}`
}

/** The object a presigned URL names: the same for every signature of it */
export function object_path(url: string): string {
	try {
		return new URL(url).pathname
	} catch {
		return url
	}
}

export type KeptTilePreview = { path: string; bytes: Uint8Array }

export async function recall_tile_preview(workspace_id: string, file_id: string): Promise<KeptTilePreview | null> {
	const shown = await recall_device_bytes(shown_key(workspace_id, file_id))
	if (!shown) return null
	const path = decoder.decode(shown)
	const bytes = await recall_device_bytes(bytes_key(path))
	return bytes ? { path, bytes } : null
}

export function tile_preview_epoch(): number {
	return device_epoch()
}

export function keep_tile_preview(workspace_id: string, file_id: string, path: string, bytes: Uint8Array, started_in: number) {
	keep_device_bytes(bytes_key(path), bytes, started_in)
	keep_device_bytes(shown_key(workspace_id, file_id), encoder.encode(path), started_in)
}

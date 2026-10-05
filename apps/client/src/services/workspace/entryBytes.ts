import type { FileManager } from '@pile-commander/file-manager'
import { mime_from_name } from '@pile-commander/file-manager'
import { get_media_kind, get_mime_type } from '@/services/board/media'

/**
 * The mime an upload has to carry. It decides text-column vs blob storage in
 * the cloud upload_file, so it must match the real type: the media table for
 * media, file-manager's table (text defaults) elsewhere — board/media alone
 * would report octet-stream for .md/.txt and route notes into blob storage.
 */
export function upload_mime(name: string): string {
	return get_media_kind(name) ? get_mime_type(name) : mime_from_name(name)
}

/**
 * Reads an entry's bytes through its file manager. A public-workspace visitor is
 * served a preview, not the file: copying it would store a webp thumb or a
 * jpeg still under this name and mime, so that is refused — the original is
 * for the workspace's members. `original` asks for the file itself (Download
 * as .pile): the backend grants it to a signed-in visitor where the author
 * allows forks and downloads, and charges that visitor.
 */
export async function read_entry_blob(
	fm: FileManager,
	id: string,
	name: string,
	mime: string,
	options: { original?: boolean } = {},
): Promise<Blob> {
	const media = await fm.get_media_src(id, { mimeType: mime, original: options.original })
	if (media.variant && media.variant !== 'original') {
		media.revoke?.()
		throw new Error(`${name}: only a preview is available, the original is for workspace members`)
	}
	try {
		const response = await fetch(media.url)
		if (!response.ok) throw new Error(`fetch failed: ${response.status}`)
		return await response.blob()
	} finally {
		media.revoke?.()
	}
}

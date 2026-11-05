import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import {
	MediaUnavailableError,
	type MediaUnavailableReason,
	type MediaVariant,
} from '@pile-commander/file-manager'
import { get_media_kind } from '@/services/board/media'
import { useWorkspace } from '@/ui/workspace/useWorkspace'
import { media_cache_key, type MediaSrcCache } from './mediaSrcCache'
import {
	keep_tile_preview,
	object_path,
	recall_tile_preview,
	tile_preview_epoch,
	type KeptTilePreview,
} from '@/services/workspace/tilePreviewCache'

/**
 * An original a tile shows because no preview comes for it (images under
 * 256 KB, GIFs, a preview the backend could not shrink) is kept on the device
 * too, up to this size. Larger ones stay on the presigned URL
 */
export const KEEP_ORIGINAL_MAX_BYTES = 1024 * 1024

/** Raster types only: a blob: URL of an active type (SVG) would run with the app's origin */
const KEEPABLE_ORIGINAL_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

/** The device keeps bytes without a type: the image format by its signature (previews are webp) */
export function sniff_image_type(bytes: Uint8Array): string {
	const at = (offset: number, text: string) =>
		bytes.length >= offset + text.length && [...text].every((ch, i) => bytes[offset + i] === ch.charCodeAt(0))
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
	if (bytes[0] === 0x89 && at(1, 'PNG')) return 'image/png'
	if (at(0, 'GIF8')) return 'image/gif'
	if (at(4, 'ftypavif') || at(4, 'ftypavis')) return 'image/avif'
	return 'image/webp'
}

function image_url(bytes: Uint8Array): string {
	const copy = new Uint8Array(bytes.byteLength)
	copy.set(bytes)
	return URL.createObjectURL(new Blob([copy], { type: sniff_image_type(copy) }))
}

type Fetched = { bytes: Uint8Array; started_in: number }

/** A preview's bytes, to keep on the device; null leaves the tile on the presigned URL */
async function fetch_preview(url: string): Promise<Fetched | null> {
	const started_in = tile_preview_epoch()
	try {
		const response = await fetch(url)
		if (!response.ok) return null
		return { bytes: new Uint8Array(await response.arrayBuffer()), started_in }
	} catch {
		return null
	}
}

/**
 * A small original's bytes, to keep on the device. Anything larger, of
 * another type or of unknown size is let go after the headers: the tile
 * then loads the presigned URL itself
 */
async function fetch_small_original(url: string): Promise<Fetched | null> {
	const started_in = tile_preview_epoch()
	const controller = new AbortController()
	try {
		const response = await fetch(url, { signal: controller.signal })
		const type = (response.headers.get('Content-Type') ?? '').split(';')[0]!.trim().toLowerCase()
		const length = Number(response.headers.get('Content-Length') ?? NaN)
		if (!response.ok || !KEEPABLE_ORIGINAL_TYPES.has(type) || !(length > 0 && length <= KEEP_ORIGINAL_MAX_BYTES)) {
			controller.abort()
			return null
		}
		const bytes = new Uint8Array(await response.arrayBuffer())
		return bytes.byteLength <= KEEP_ORIGINAL_MAX_BYTES ? { bytes, started_in } : null
	} catch {
		return null
	}
}

/**
 * A file's URL for showing it in a tile. An image asks for its ready preview
 * (a cloud webp thumb, 1600 px) unless `preview: false`; until there is one,
 * and everywhere previews do not exist, the original comes. A video keeps its
 * original: a board card plays it, and the player only reads its metadata
 */
export function useMediaSrc(
	fileId: MaybeRefOrGetter<string>,
	filename: MaybeRefOrGetter<string>,
	options: { preview?: boolean } = {},
) {
	const src = ref('')
	const loading = ref(true)
	const error = ref(false)
	/** set when the backend refused a public-board visitor (egress fair use) */
	const unavailable = ref<MediaUnavailableReason | null>(null)
	/** what src serves: a public-board visitor may get a preview (a poster is an image) */
	const variant = ref<MediaVariant>('original')
	const workspace = useWorkspace()
	/** The cache key held: the file id, with the preview ask when there was one */
	let heldId: string | null = null
	let heldCache: MediaSrcCache | null = null
	let loadGeneration = 0

	function releaseHeld() {
		if (heldId && heldCache) {
			heldCache.release(heldId)
		}
		heldId = null
		heldCache = null
	}

	async function load() {
		const id = toValue(fileId)
		const name = toValue(filename)
		const generation = ++loadGeneration

		releaseHeld()
		src.value = ''
		error.value = false
		unavailable.value = null
		variant.value = 'original'

		const ws = workspace.value
		if (!id || !ws) {
			loading.value = false
			error.value = true
			return
		}

		const cache = ws.media_cache
		const preview = (options.preview ?? true) && get_media_kind(name) === 'image'
		const key = media_cache_key(id, preview)
		// a cloud image's preview may be on this device: shown at once, checked below
		const on_device = preview && ws.type === 'cloud'
		let kept: KeptTilePreview | null = null
		let kept_url: string | null = null
		loading.value = true
		if (on_device && !cache.has(key)) {
			kept = await recall_tile_preview(ws.uid, id)
			if (generation !== loadGeneration) return
			if (kept) {
				kept_url = image_url(kept.bytes)
				src.value = kept_url
				variant.value = 'thumb'
				loading.value = false
			}
		}
		try {
			const entry = await cache.acquire(key, async () => {
				const media = await ws.get_media_src(id, name, { preview })
				const got_preview = media.variant !== undefined && media.variant !== 'original'
				if (on_device) {
					const path = object_path(media.url)
					// the same object as on the device: nothing to download
					if (kept && kept_url && kept.path === path) {
						const url = kept_url
						return { url, revoke: () => URL.revokeObjectURL(url), expires_at: media.expires_at, variant: media.variant }
					}
					// no preview yet, or none ever (a small image): a small original is
					// kept like a preview. Once a preview is made it is another object,
					// and the next check replaces the kept original with it
					const fetched = got_preview ? await fetch_preview(media.url) : await fetch_small_original(media.url)
					if (fetched) {
						keep_tile_preview(ws.uid, id, path, fetched.bytes, fetched.started_in)
						const url = image_url(fetched.bytes)
						return { url, revoke: () => URL.revokeObjectURL(url), expires_at: media.expires_at, variant: media.variant }
					}
				}
				// kept for the way back while the URL lives: the same URL is a browser
				// cache hit. A preview made meanwhile comes with the next URL
				return {
					url: media.url,
					revoke: media.revoke ?? (() => {}),
					expires_at: media.expires_at,
					variant: media.variant,
				}
			})
			// the device's copy was not taken over (another tile's entry, or a newer object)
			if (kept_url && entry.url !== kept_url) URL.revokeObjectURL(kept_url)
			if (generation !== loadGeneration) {
				cache.release(key)
				return
			}
			heldId = key
			heldCache = cache
			variant.value = entry.variant ?? 'original'
			src.value = entry.url
		} catch (err) {
			if (kept_url) URL.revokeObjectURL(kept_url)
			if (generation === loadGeneration) {
				src.value = ''
				error.value = true
				unavailable.value = err instanceof MediaUnavailableError ? err.reason : null
			}
		} finally {
			if (generation === loadGeneration) {
				loading.value = false
			}
		}
	}

	// the version moves when the file's bytes change under the same id
	watch(() => {
		const id = toValue(fileId)
		return [id, toValue(filename), workspace.value?.media_cache.version(id) ?? 0] as const
	}, () => {
		void load()
	}, { immediate: true })

	// the component's own scope ends at unmount; any other scope (a test, a composable) works the same
	onScopeDispose(() => {
		loadGeneration += 1
		releaseHeld()
	})

	return { src, loading, error, unavailable, variant }
}
